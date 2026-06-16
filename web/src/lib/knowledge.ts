import { prisma } from "@/lib/prisma";
import { embed, EMBEDDING_MODEL_NAME } from "@/lib/embeddings";
import { normalize, serialize, cosineTopK } from "@/lib/vectors";

export type ChunkInput = {
  kind: "product" | "ingredient";
  refId?: string;
  title: string;
  text: string;
  metadata: Record<string, unknown>;
};

/** 텍스트를 임베딩(정규화)해 KnowledgeChunk를 refId+kind 기준 upsert한다. */
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
    where: { kind: input.kind, refId: input.refId ?? null },
    select: { id: true },
  });
  if (existing) await prisma.knowledgeChunk.update({ where: { id: existing.id }, data });
  else await prisma.knowledgeChunk.create({ data });
}

export type KnowledgeHit = { title: string; text: string; metadata: Record<string, unknown>; score: number };

/** 질의를 임베딩해 해당 kind에서 코사인 top-k를 반환한다. */
export async function retrieve(query: string, kind: "product" | "ingredient", k: number): Promise<KnowledgeHit[]> {
  const [qvec] = await embed([query], "query");
  const q = normalize(qvec);
  const chunks = await prisma.knowledgeChunk.findMany({ where: { kind } });
  const top = cosineTopK(q, chunks as unknown as Array<typeof chunks[0] & { embedding: Buffer }>, k);
  return top.map((c) => ({
    title: c.title,
    text: c.text,
    metadata: JSON.parse(c.metadata || "{}"),
    score: c.score,
  }));
}
