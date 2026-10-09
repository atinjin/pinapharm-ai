import { prisma } from "@/lib/prisma";
import { embed, EMBEDDING_MODEL_NAME } from "@/lib/embeddings";
import { normalize, serialize, cosineTopK } from "@/lib/vectors";
import { chunk } from "@/lib/chunking";
import { recordRevision } from "@/lib/revisions";

export type ChunkInput = {
  kind: "product" | "knowledge";
  refId?: string;
  title: string;
  text: string;
  metadata: Record<string, unknown>;
};

// 제품 청크용(파생: 1제품=1청크, documentId=null). 텍스트를 임베딩해 (kind, refId) 기준 upsert.
export async function upsertChunk(input: ChunkInput): Promise<void> {
  const [vec] = await embed([input.text], "document");
  const embedding = serialize(normalize(vec)) as unknown as Uint8Array<ArrayBuffer>;
  const data = {
    kind: input.kind,
    refId: input.refId ?? null,
    title: input.title,
    text: input.text,
    metadata: JSON.stringify(input.metadata ?? {}),
    embedding,
    model: EMBEDDING_MODEL_NAME,
  };
  const existing = await prisma.knowledgeChunk.findFirst({
    where: { kind: input.kind, refId: input.refId ?? null, documentId: null },
    select: { id: true },
  });
  if (existing) await prisma.knowledgeChunk.update({ where: { id: existing.id }, data });
  else await prisma.knowledgeChunk.create({ data });
}

const EMPTY_EMBEDDING = Buffer.alloc(0) as unknown as Uint8Array<ArrayBuffer>;

// 지식 문서 생성: body를 청킹 → 청크별 임베딩(best-effort) → 문서 + 청크 저장.
// 임베딩 실패 청크는 embeddingStale=true(검색 제외, 추후 재임베딩).
export async function createDocument(input: {
  category?: string;
  title: string;
  body: string;
  source?: Record<string, unknown>;
}): Promise<{ id: number; chunks: number }> {
  const pieces = chunk(input.body);
  const doc = await prisma.knowledgeDocument.create({
    data: {
      category: input.category ?? "general",
      title: input.title,
      body: input.body,
      source: JSON.stringify(input.source ?? {}),
    },
  });
  for (let i = 0; i < pieces.length; i++) {
    let embedding = EMPTY_EMBEDDING;
    let stale = false;
    try {
      const [vec] = await embed([pieces[i]], "document");
      embedding = serialize(normalize(vec)) as unknown as Uint8Array<ArrayBuffer>;
    } catch {
      stale = true;
    }
    await prisma.knowledgeChunk.create({
      data: {
        kind: "knowledge",
        documentId: doc.id,
        chunkIndex: i,
        title: input.title,
        text: pieces[i],
        metadata: "{}",
        embedding,
        model: EMBEDDING_MODEL_NAME,
        embeddingStale: stale,
      },
    });
  }
  await recordRevision(
    "knowledgeDocument",
    String(doc.id),
    { category: input.category ?? "general", title: input.title, body: input.body, source: input.source ?? {} },
    "생성"
  );
  return { id: doc.id, chunks: pieces.length };
}

export type KnowledgeHit = {
  title: string;
  text: string;
  source: Record<string, unknown>;
  score: number;
  documentId: number;
};

// 끝 한 글자 조사를 떼어 "눈이"→"눈"처럼 본문과 맞춘다
const JOSA_RE = /(이|가|은|는|을|를|에|의|도|로|와|과)$/;

function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const t of query.toLowerCase().split(/[\s.,!?·/()]+/).filter(Boolean)) {
    terms.add(t);
    if (t.length >= 2 && JOSA_RE.test(t)) terms.add(t.slice(0, -1));
  }
  return [...terms];
}

// 임베딩 장애 시 폴백: 문서 청크(제목+본문)에 질의 단어가 몇 개 들어 있는지로 top-k.
// 벡터와 무관하므로 stale·다른 모델 청크도 대상이다. score는 맞은 단어 비율.
async function retrieveLexical(query: string, k: number): Promise<KnowledgeHit[]> {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const chunks = await prisma.knowledgeChunk.findMany({
    where: { documentId: { not: null } },
    include: { document: true },
  });
  return chunks
    .map((c) => {
      const hay = `${c.document?.title ?? c.title} ${c.text}`.toLowerCase();
      return { c, score: terms.filter((t) => hay.includes(t)).length / terms.length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ c, score }) => ({
      title: c.document?.title ?? c.title,
      text: c.text,
      source: JSON.parse(c.document?.source || "{}"),
      score,
      documentId: c.documentId as number,
    }));
}

// 질의를 임베딩해 지식 문서 청크(documentId 있음, 임베딩 정상, 같은 모델)에서 코사인 top-k. 출처(문서 source) 포함.
// 질의 임베딩이 실패하면(재시도 소진 포함) 어휘 매칭으로 폴백한다. 응답 형태는 같다.
export async function retrieve(query: string, k: number): Promise<KnowledgeHit[]> {
  let qvec: number[];
  try {
    [qvec] = await embed([query], "query");
  } catch (e) {
    console.error("지식 의미검색 실패 → 어휘 폴백", e);
    return retrieveLexical(query, k);
  }
  const q = normalize(qvec);
  const chunks = await prisma.knowledgeChunk.findMany({
    where: { documentId: { not: null }, embeddingStale: false, model: EMBEDDING_MODEL_NAME },
    include: { document: true },
  });
  const top = cosineTopK(
    q,
    chunks as unknown as Array<(typeof chunks)[number] & { embedding: Buffer }>,
    k
  );
  return top.map((c) => ({
    title: c.document?.title ?? c.title,
    text: c.text,
    source: JSON.parse(c.document?.source || "{}"),
    score: c.score,
    documentId: c.documentId as number,
  }));
}
