import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map((t) => (t.includes("눈") ? [1, 0] : [0, 1]))),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { createDocument, retrieve, upsertChunk } from "@/lib/knowledge";

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
});

describe("knowledge documents + retrieve", () => {
  it("createDocument chunks body; retrieve returns top-k from documents with source", async () => {
    await createDocument({
      category: "ingredient",
      title: "루테인",
      body: "눈 건강 유지에 도움",
      source: { 출처: "식약처" },
    });
    await createDocument({ category: "ingredient", title: "유산균", body: "장 건강에 도움" });

    const hits = await retrieve("눈이 침침", 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe("루테인");
    expect(hits[0].source).toEqual({ 출처: "식약처" });
    expect(hits[0].documentId).toBeGreaterThan(0);
  });

  it("long body splits into multiple chunks", async () => {
    const body = Array.from({ length: 30 }, (_, i) => `문단${i} ` + "가".repeat(60)).join("\n\n");
    const res = await createDocument({ title: "긴 문서", body });
    expect(res.chunks).toBeGreaterThan(1);
  });

  it("retrieve excludes product chunks (documentId null)", async () => {
    await upsertChunk({ kind: "product", refId: "1", title: "눈 영양제", text: "눈 좋은 제품", metadata: {} });
    const hits = await retrieve("눈", 5);
    expect(hits).toHaveLength(0); // 문서 청크만 검색
  });

  it("질의 임베딩이 실패하면 청크 본문 어휘 매칭으로 top-k를 돌려준다", async () => {
    await createDocument({ title: "루테인", body: "눈 건강 유지에 도움", source: { 출처: "식약처" } });
    await createDocument({ title: "유산균", body: "장 건강에 도움" });
    await createDocument({ title: "마그네슘", body: "근육 경련 완화" });
    const mod = await import("@/lib/embeddings");
    (mod.embed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("voyage 429"));

    const hits = await retrieve("눈이 침침하고 건강 걱정", 2);
    expect(hits.map((h) => h.title)).toEqual(["루테인", "유산균"]); // 루테인: 눈+건강, 유산균: 건강
    expect(hits[0].source).toEqual({ 출처: "식약처" });
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("어휘 폴백은 겹치는 단어가 없으면 빈 배열", async () => {
    await createDocument({ title: "루테인", body: "눈 건강 유지에 도움" });
    const mod = await import("@/lib/embeddings");
    (mod.embed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("down"));
    expect(await retrieve("오메가", 3)).toEqual([]);
  });

  it("retrieve는 질의와 다른 모델로 만든 청크를 제외한다", async () => {
    const d = await createDocument({ title: "루테인", body: "눈 건강 유지에 도움" });
    await prisma.knowledgeChunk.updateMany({ where: { documentId: d.id }, data: { model: "old-model" } });
    const hits = await retrieve("눈이 침침", 5);
    expect(hits).toHaveLength(0);
  });
});
