import { prisma } from "@/lib/prisma";

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

type Searchable = { name: string; description?: string | null; conditionTags: string };

export function matchesQuery(p: Searchable, q: string): boolean {
  const hay = [p.name, p.description ?? "", parseTags(p.conditionTags).join(" ")]
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

export async function searchProducts(opts: { condition?: string; keyword?: string }) {
  const all = await prisma.product.findMany({ where: { isActive: true } });
  const terms = [opts.condition, opts.keyword].filter(Boolean) as string[];
  if (terms.length === 0) return all;
  const expanded = expandQueryTags(terms.join(" "));
  return all.filter((p) => {
    if (terms.some((t) => matchesQuery(p, t))) return true; // 직접 부분일치
    if (expanded.size === 0) return false;
    return parseTags(p.conditionTags).some((t) => expanded.has(t)); // 동의어 태그 일치
  });
}

export async function listProducts() {
  return prisma.product.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createProduct(input: {
  name: string; price: number; pharmacistId: number;
  brand?: string; description?: string; ingredients?: string;
  conditionTags?: string[]; imageUrl?: string; stock?: number;
}) {
  const { conditionTags, ...rest } = input;
  return prisma.product.create({
    data: { ...rest, conditionTags: stringifyTags(conditionTags ?? []) },
  });
}

export async function updateProduct(id: number, input: {
  name?: string; price?: number; brand?: string; description?: string;
  ingredients?: string; conditionTags?: string[]; imageUrl?: string;
  stock?: number; isActive?: boolean;
}) {
  const { conditionTags, ...rest } = input;
  return prisma.product.update({
    where: { id },
    data: { ...rest, ...(conditionTags ? { conditionTags: stringifyTags(conditionTags) } : {}) },
  });
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
      await prisma.product.create({
        data: { ...rest, pharmacistId, conditionTags: stringifyTags(conditionTags ?? []) },
      });
      created++;
    } catch (e) {
      failed.push({ index: i, name: inputs[i].name, message: e instanceof Error ? e.message : "unknown" });
    }
  }
  return { created, failed };
}
