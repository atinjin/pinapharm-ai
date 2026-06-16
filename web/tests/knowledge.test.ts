import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) =>
    texts.map((t) => (t.includes("눈") ? [1, 0] : [0, 1]))
  ),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { upsertChunk, retrieve } from "@/lib/knowledge";

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
});

describe("knowledge retrieve", () => {
  it("returns top-k by cosine within a kind", async () => {
    await upsertChunk({ kind: "ingredient", refId: "루테인", title: "루테인", text: "눈 건강", metadata: {} });
    await upsertChunk({ kind: "ingredient", refId: "유산균", title: "유산균", text: "장 건강", metadata: {} });

    const hits = await retrieve("눈이 침침", "ingredient", 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe("루테인");
    expect(hits[0].score).toBeGreaterThan(0.9);
  });

  it("filters by kind", async () => {
    await upsertChunk({ kind: "product", refId: "1", title: "P", text: "눈 영양제", metadata: {} });
    const hits = await retrieve("눈", "ingredient", 5);
    expect(hits).toHaveLength(0);
  });
});
