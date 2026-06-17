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
});
