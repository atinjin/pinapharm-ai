import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { embed, EMBEDDING_MODEL_NAME } from "@/lib/embeddings";
import { normalize, serialize, cosineTopK } from "@/lib/vectors";
import { chunk } from "@/lib/chunking";
import { recordRevision } from "@/lib/revisions";

const EMPTY_EMBEDDING = Buffer.alloc(0) as unknown as Uint8Array<ArrayBuffer>;

export type DocumentRow = {
  id: number;
  category: string;
  title: string;
  source: Record<string, unknown>;
  reviewedAt: string | null;
  chunkCount: number;
  staleCount: number;
  updatedAt: string;
};

export async function listDocuments(opts: {
  category?: string;
  q?: string;
  reviewed?: boolean;
  skip?: number;
  take?: number;
}): Promise<{ rows: DocumentRow[]; total: number }> {
  const where: Prisma.KnowledgeDocumentWhereInput = {};
  if (opts.category) where.category = opts.category;
  if (opts.reviewed === true) where.reviewedAt = { not: null };
  if (opts.reviewed === false) where.reviewedAt = null;
  if (opts.q) where.OR = [{ title: { contains: opts.q } }, { body: { contains: opts.q } }];

  const [docs, total] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: opts.skip ?? 0,
      take: opts.take ?? 20,
      include: { chunks: { select: { embeddingStale: true } } },
    }),
    prisma.knowledgeDocument.count({ where }),
  ]);

  const rows = docs.map((d) => ({
    id: d.id,
    category: d.category,
    title: d.title,
    source: JSON.parse(d.source || "{}"),
    reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString() : null,
    chunkCount: d.chunks.length,
    staleCount: d.chunks.filter((c) => c.embeddingStale).length,
    updatedAt: d.updatedAt.toISOString(),
  }));
  return { rows, total };
}

export async function getDocument(id: number) {
  const d = await prisma.knowledgeDocument.findUnique({
    where: { id },
    include: {
      chunks: {
        select: { id: true, chunkIndex: true, text: true, embeddingStale: true, model: true },
        orderBy: { chunkIndex: "asc" },
      },
    },
  });
  if (!d) return null;
  return { ...d, source: JSON.parse(d.source || "{}") };
}

async function rebuildChunks(documentId: number, title: string, body: string): Promise<number> {
  await prisma.knowledgeChunk.deleteMany({ where: { documentId } });
  const pieces = chunk(body);
  for (let i = 0; i < pieces.length; i++) {
    let embedding = EMPTY_EMBEDDING;
    let stale = false;
    try {
      const [v] = await embed([pieces[i]], "document");
      embedding = serialize(normalize(v)) as unknown as Uint8Array<ArrayBuffer>;
    } catch {
      stale = true;
    }
    await prisma.knowledgeChunk.create({
      data: {
        kind: "knowledge",
        documentId,
        chunkIndex: i,
        title,
        text: pieces[i],
        metadata: "{}",
        embedding,
        model: EMBEDDING_MODEL_NAME,
        embeddingStale: stale,
      },
    });
  }
  return pieces.length;
}

// 문서 수정: 내용 변경 → 검수 필요로 리셋. body 변경 시 재청킹+재임베딩, title만 변경 시 청크 제목만 갱신.
export async function updateDocument(
  id: number,
  input: { category?: string; title?: string; body?: string; source?: Record<string, unknown> }
) {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id } });
  if (!doc) throw new Error("문서를 찾을 수 없습니다");
  const title = input.title ?? doc.title;
  const bodyChanged = input.body !== undefined && input.body !== doc.body;
  await prisma.knowledgeDocument.update({
    where: { id },
    data: {
      category: input.category ?? doc.category,
      title,
      body: input.body ?? doc.body,
      source: input.source !== undefined ? JSON.stringify(input.source) : doc.source,
      reviewedAt: null,
    },
  });
  if (bodyChanged) await rebuildChunks(id, title, input.body as string);
  else if (input.title && input.title !== doc.title)
    await prisma.knowledgeChunk.updateMany({ where: { documentId: id }, data: { title } });
  await recordRevision(
    "knowledgeDocument",
    String(id),
    {
      category: input.category ?? doc.category,
      title,
      body: input.body ?? doc.body,
      source: input.source !== undefined ? input.source : JSON.parse(doc.source || "{}"),
    },
    "수정"
  );
  return getDocument(id);
}

export async function deleteDocument(id: number): Promise<void> {
  await prisma.knowledgeDocument.delete({ where: { id } }); // 청크 onDelete: Cascade
}

export async function setReviewed(id: number, reviewed: boolean): Promise<void> {
  await prisma.knowledgeDocument.update({
    where: { id },
    data: { reviewedAt: reviewed ? new Date() : null },
  });
}

// 저장된 청크 텍스트로 재임베딩(재청킹 없이). 실패 청크는 stale 유지.
export async function reembedDocument(id: number): Promise<void> {
  const chunks = await prisma.knowledgeChunk.findMany({ where: { documentId: id } });
  for (const c of chunks) {
    try {
      const [v] = await embed([c.text], "document");
      const embedding = serialize(normalize(v)) as unknown as Uint8Array<ArrayBuffer>;
      await prisma.knowledgeChunk.update({
        where: { id: c.id },
        data: { embedding, model: EMBEDDING_MODEL_NAME, embeddingStale: false },
      });
    } catch {
      /* keep stale */
    }
  }
}

export type ChunkSearchHit = {
  id: number;
  documentId: number;
  docTitle: string;
  text: string;
  chunkIndex: number;
  score: number;
};

// 검색 테스트: 질의를 임베딩해 문서 청크 top-k(청크·문서 식별자 포함) 반환.
export async function searchChunks(query: string, k: number): Promise<ChunkSearchHit[]> {
  const [qv] = await embed([query], "query");
  const q = normalize(qv);
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
    id: c.id,
    documentId: c.documentId as number,
    docTitle: c.document?.title ?? "",
    text: c.text,
    chunkIndex: c.chunkIndex,
    score: c.score,
  }));
}
