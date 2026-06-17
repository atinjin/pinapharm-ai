import { prisma } from "@/lib/prisma";
import { upsertChunk } from "@/lib/knowledge";
import { embed } from "@/lib/embeddings";
import { normalize, cosineTopK } from "@/lib/vectors";

// 의미검색 임계값/개수 (정규화 Voyage 벡터 기준, 추후 튜닝 가능)
const SEMANTIC_MIN_SCORE = 0.2;
const SEMANTIC_TOP_K = 10;

export function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function stringifyTags(tags: string[]): string {
  return JSON.stringify(tags);
}

// 제품 1건을 KnowledgeChunk(kind=product)로 색인. 실패는 무시(임베딩 장애 시 lexical 폴백).
export async function indexProduct(p: {
  id: number; name: string; brand?: string | null; description?: string | null;
  ingredients?: string | null; conditionTags: string;
}): Promise<void> {
  try {
    const tags = parseTags(p.conditionTags).join(" ");
    const text = [p.name, p.brand, p.description, p.ingredients, tags].filter(Boolean).join(" / ");
    await upsertChunk({
      kind: "product",
      refId: String(p.id),
      title: p.name,
      text,
      metadata: { brand: p.brand ?? null },
    });
  } catch (e) {
    console.error(`product 색인 실패(무시) id=${p.id}`, e);
  }
}

type Searchable = {
  name: string;
  description?: string | null;
  ingredients?: string | null;
  ingredientsStructured?: string | null;
  conditionTags: string;
};

export function matchesQuery(p: Searchable, q: string): boolean {
  const hay = [
    p.name,
    p.description ?? "",
    p.ingredients ?? "",
    p.ingredientsStructured ?? "",
    parseTags(p.conditionTags).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

// 자연어 증상 표현 → 증상 태그 동의어 사전 (예: "피곤"→피로, "잠"→수면)
const SYMPTOM_SYNONYMS: Record<string, string[]> = {
  피로: ["피곤", "피로", "기운", "무기력", "지침", "지쳐", "에너지", "활력", "원기"],
  면역: ["면역", "감기", "잔병", "항산화"],
  눈건강: ["눈", "시력", "침침", "뻑뻑", "황반", "루테인"],
  수면: ["잠", "수면", "불면", "잠들", "숙면", "뒤척", "못자", "못 자"],
  장건강: ["장", "배변", "변비", "유산균", "프로바이오틱스", "속이", "더부룩", "설사"],
  소화: ["소화", "위", "체기", "더부룩", "속쓰"],
  관절: ["관절", "무릎", "연골", "삐걱"],
  뼈건강: ["뼈", "골다공", "칼슘", "골밀도"],
  혈행: ["혈행", "혈압", "콜레스테롤", "중성지방", "혈액순환", "손발", "저림", "혈당"],
  근육경련: ["근육", "쥐", "경련", "마그네슘"],
  피부: ["피부", "콜라겐", "각질", "건조"],
  간건강: ["간", "숙취", "피곤한 간"],
};

function expandQueryTags(q: string): Set<string> {
  const tags = new Set<string>();
  for (const [tag, words] of Object.entries(SYMPTOM_SYNONYMS)) {
    if (words.some((w) => q.includes(w))) tags.add(tag);
  }
  return tags;
}

async function semanticProductIds(queryText: string, k: number): Promise<number[]> {
  const [qvec] = await embed([queryText], "query");
  const q = normalize(qvec);
  const chunks = await prisma.knowledgeChunk.findMany({ where: { kind: "product" } });
  return cosineTopK(q, chunks as unknown as Array<(typeof chunks)[number] & { embedding: Buffer }>, k)
    .filter((c) => c.score > SEMANTIC_MIN_SCORE)
    .map((c) => Number(c.refId))
    .filter((n) => Number.isFinite(n));
}

export type ProductSearchCriteria = {
  condition?: string;
  keyword?: string;
  ingredients?: string[];
  form?: string;
  minDose?: number;
  maxDose?: number;
  excludeAllergens?: string[];
};

// 컨텍스트 기반 구조화 제품 검색: 구조화 필터(데이터 있는 경우만 불일치 제외, 알레르겐은 안전상 하드 제외)
// + lexical·의미 랭킹. 반환 형태(Product[])·추천 파이프라인은 보존.
export async function searchProducts(opts: ProductSearchCriteria) {
  const all = await prisma.product.findMany({ where: { isActive: true } });
  const ingredients = opts.ingredients ?? [];
  const exclude = (opts.excludeAllergens ?? []).map((a) => a.toLowerCase()).filter(Boolean);

  const filtered = all.filter((p) => {
    if (exclude.length) {
      const hay = [p.name, p.ingredients ?? "", p.ingredientsStructured ?? "", parseTags(p.conditionTags).join(" ")]
        .join(" ")
        .toLowerCase();
      if (exclude.some((a) => hay.includes(a))) return false; // 알레르겐 포함 → 제외(안전)
    }
    if (opts.form && p.form && p.form.toLowerCase() !== opts.form.toLowerCase()) return false;
    if (p.doseAmount != null) {
      if (opts.minDose != null && p.doseAmount < opts.minDose) return false;
      if (opts.maxDose != null && p.doseAmount > opts.maxDose) return false;
    }
    return true;
  });

  const terms = [opts.condition, opts.keyword, ...ingredients].filter(Boolean) as string[];
  if (terms.length === 0) return filtered;

  const expanded = expandQueryTags(terms.join(" "));
  const lexical = filtered.filter((p) => {
    if (terms.some((t) => matchesQuery(p, t))) return true;
    if (expanded.size === 0) return false;
    return parseTags(p.conditionTags).some((t) => expanded.has(t));
  });

  let semantic: typeof all = [];
  try {
    const ids = await semanticProductIds(terms.join(" "), SEMANTIC_TOP_K);
    const byId = new Map(filtered.map((p) => [p.id, p]));
    semantic = ids.map((id) => byId.get(id)).filter((p): p is (typeof all)[number] => !!p);
  } catch (e) {
    console.error("의미검색 실패 → lexical만 사용", e);
  }

  const seen = new Set<number>();
  const merged: typeof all = [];
  for (const p of [...semantic, ...lexical]) {
    if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
  }
  return merged;
}

export async function listProducts() {
  return prisma.product.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createProduct(input: {
  name: string; price: number; pharmacistId: number;
  brand?: string; description?: string; ingredients?: string;
  form?: string; doseAmount?: number; doseUnit?: string; ingredientsStructured?: string;
  conditionTags?: string[]; imageUrl?: string; stock?: number;
}) {
  const { conditionTags, ...rest } = input;
  const product = await prisma.product.create({
    data: { ...rest, conditionTags: stringifyTags(conditionTags ?? []) },
  });
  await indexProduct(product);
  return product;
}

export async function updateProduct(id: number, input: {
  name?: string; price?: number; brand?: string; description?: string;
  ingredients?: string; form?: string; doseAmount?: number; doseUnit?: string; ingredientsStructured?: string;
  conditionTags?: string[]; imageUrl?: string;
  stock?: number; isActive?: boolean;
}) {
  const { conditionTags, ...rest } = input;
  const product = await prisma.product.update({
    where: { id },
    data: { ...rest, ...(conditionTags ? { conditionTags: stringifyTags(conditionTags) } : {}) },
  });
  await indexProduct(product);
  return product;
}

export async function deleteProduct(id: number) {
  return prisma.product.delete({ where: { id } });
}

export type BulkProductInput = {
  name: string;
  price: number;
  brand?: string;
  description?: string;
  ingredients?: string;
  conditionTags?: string[];
  imageUrl?: string;
  stock?: number;
  isActive?: boolean;
};

/** 여러 상품을 한 번에 등록한다. 행 단위 실패는 모아서 보고한다. */
export async function createManyProducts(
  inputs: BulkProductInput[],
  pharmacistId = 1
): Promise<{ created: number; failed: { index: number; name: string; message: string }[] }> {
  let created = 0;
  const failed: { index: number; name: string; message: string }[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const { conditionTags, ...rest } = inputs[i];
    try {
      const row = await prisma.product.create({
        data: { ...rest, pharmacistId, conditionTags: stringifyTags(conditionTags ?? []) },
      });
      await indexProduct(row);
      created++;
    } catch (e) {
      failed.push({ index: i, name: inputs[i].name, message: e instanceof Error ? e.message : "unknown" });
    }
  }
  return { created, failed };
}
