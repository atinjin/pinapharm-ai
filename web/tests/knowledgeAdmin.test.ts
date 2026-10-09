import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map((t) => (t.includes("눈") ? [1, 0] : [0, 1]))),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { createDocument } from "@/lib/knowledge";
import {
  listDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
  setReviewed,
  reembedDocument,
  reembedOutdatedChunks,
  searchChunks,
} from "@/lib/knowledgeAdmin";

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
});

describe("knowledgeAdmin", () => {
  it("listDocuments filters by category/q/reviewed and counts chunks", async () => {
    const a = await createDocument({ category: "ingredient", title: "루테인", body: "눈 건강" });
    await createDocument({ category: "reference", title: "오메가 논문", body: "혈행 개선" });

    expect((await listDocuments({})).total).toBe(2);
    expect((await listDocuments({ category: "reference" })).rows).toHaveLength(1);
    expect((await listDocuments({ q: "루테인" })).rows[0].title).toBe("루테인");
    expect((await listDocuments({ reviewed: false })).total).toBe(2); // 둘 다 검수 필요

    await setReviewed(a.id, true);
    const reviewed = await listDocuments({ reviewed: true });
    expect(reviewed.rows.map((r) => r.title)).toEqual(["루테인"]);
    expect(reviewed.rows[0].chunkCount).toBeGreaterThan(0);
  });

  it("updateDocument with new body re-chunks and resets review", async () => {
    const d = await createDocument({ title: "문서", body: "짧은 내용" });
    await setReviewed(d.id, true);
    const longBody = Array.from({ length: 20 }, (_, i) => `문단${i} ` + "가".repeat(60)).join("\n\n");
    await updateDocument(d.id, { body: longBody });
    const got = await getDocument(d.id);
    expect(got!.chunks.length).toBeGreaterThan(1);
    expect(got!.reviewedAt).toBeNull();
  });

  it("deleteDocument cascades chunks", async () => {
    const d = await createDocument({ title: "삭제용", body: "내용" });
    await deleteDocument(d.id);
    expect(await prisma.knowledgeDocument.findUnique({ where: { id: d.id } })).toBeNull();
    expect(await prisma.knowledgeChunk.count({ where: { documentId: d.id } })).toBe(0);
  });

  it("searchChunks returns ranked chunks with ids", async () => {
    const d = await createDocument({ title: "루테인", body: "눈 건강 유지" });
    const hits = await searchChunks("눈이 침침", 3);
    expect(hits[0].documentId).toBe(d.id);
    expect(hits[0].id).toBeGreaterThan(0);
    expect(hits[0].docTitle).toBe("루테인");
  });

  it("searchChunks는 질의와 다른 모델로 만든 청크를 제외한다", async () => {
    const d = await createDocument({ title: "루테인", body: "눈 건강 유지" });
    await prisma.knowledgeChunk.updateMany({ where: { documentId: d.id }, data: { model: "old-model" } });
    expect(await searchChunks("눈이 침침", 3)).toHaveLength(0);
  });

  it("reembedOutdatedChunks는 다른 모델·stale 문서 청크만 현재 모델로 다시 임베딩한다", async () => {
    const old = await createDocument({ title: "구모델", body: "눈 건강" });
    const stale = await createDocument({ title: "미완", body: "장 건강" });
    const cur = await createDocument({ title: "최신", body: "뼈 건강" });
    await prisma.knowledgeChunk.updateMany({ where: { documentId: old.id }, data: { model: "old-model" } });
    await prisma.knowledgeChunk.updateMany({ where: { documentId: stale.id }, data: { embeddingStale: true } });
    const mod = await import("@/lib/embeddings");
    const calls = (mod.embed as ReturnType<typeof vi.fn>).mock.calls.length;

    const res = await reembedOutdatedChunks();

    expect(res).toEqual({ updated: 2, failed: 0 });
    expect((mod.embed as ReturnType<typeof vi.fn>).mock.calls.length - calls).toBe(2); // 최신 청크는 건드리지 않음
    const rows = await prisma.knowledgeChunk.findMany({ where: { documentId: { in: [old.id, stale.id, cur.id] } } });
    expect(rows.every((r) => r.model === "test-model" && !r.embeddingStale)).toBe(true);
    expect(await searchChunks("눈", 1)).toHaveLength(1);
  });

  it("reembedOutdatedChunks는 임베딩 실패 청크를 stale로 남기고 failed로 센다", async () => {
    const d = await createDocument({ title: "구모델", body: "내용" });
    await prisma.knowledgeChunk.updateMany({ where: { documentId: d.id }, data: { model: "old-model" } });
    const mod = await import("@/lib/embeddings");
    (mod.embed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("429"));
    expect(await reembedOutdatedChunks()).toEqual({ updated: 0, failed: 1 });
    const row = await prisma.knowledgeChunk.findFirstOrThrow({ where: { documentId: d.id } });
    expect(row.embeddingStale).toBe(true);
  });

  it("reembedDocument clears stale flag", async () => {
    const d = await createDocument({ title: "재임베딩", body: "내용" });
    await prisma.knowledgeChunk.updateMany({ where: { documentId: d.id }, data: { embeddingStale: true } });
    await reembedDocument(d.id);
    const stale = await prisma.knowledgeChunk.count({ where: { documentId: d.id, embeddingStale: true } });
    expect(stale).toBe(0);
  });
});
