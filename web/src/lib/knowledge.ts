import { prisma } from "@/lib/prisma";
import { embed, EMBEDDING_MODEL_NAME } from "@/lib/embeddings";
import { normalize, serialize, cosineTopK } from "@/lib/vectors";
import { chunk } from "@/lib/chunking";

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
  return { id: doc.id, chunks: pieces.length };
}

export type KnowledgeHit = {
  title: string;
  text: string;
  source: Record<string, unknown>;
  score: number;
  documentId: number;
};

// 질의를 임베딩해 지식 문서 청크(documentId 있음, 임베딩 정상)에서 코사인 top-k. 출처(문서 source) 포함.
export async function retrieve(query: string, k: number): Promise<KnowledgeHit[]> {
  const [qvec] = await embed([query], "query");
  const q = normalize(qvec);
  const chunks = await prisma.knowledgeChunk.findMany({
    where: { documentId: { not: null }, embeddingStale: false },
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
