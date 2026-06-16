import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map((t) => (/(축\s*처|기운)/.test(t) ? [1, 0] : [0, 1]))),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { searchProducts, indexProduct } from "@/lib/products";

describe("searchProducts hybrid", () => {
  let productId: number;

  beforeEach(async () => {
    await prisma.knowledgeChunk.deleteMany({ where: { kind: "product" } });
    const p = await prisma.product.create({
      data: { name: `RAG테스트제품_${Date.now()}`, price: 1000, pharmacistId: 1, description: "기운 보충용", conditionTags: "[]" },
    });
    productId = p.id;
    await indexProduct(p); // 문서 텍스트에 '기운' 포함 → mock [1,0]
  });

  afterEach(async () => {
    await prisma.knowledgeChunk.deleteMany({ where: { kind: "product" } });
    await prisma.product.deleteMany({ where: { id: productId } });
  });

  it("finds product via semantic match when lexical/synonym misses", async () => {
    // '축 처지고'는 동의어 사전·부분일치로 이 제품을 못 잡지만, 의미검색이 잡아야 한다
    const results = await searchProducts({ condition: "축 처지고" });
    expect(results.some((r) => r.id === productId)).toBe(true);
  });

  it("falls back to lexical when embedding throws (no crash)", async () => {
    const mod = await import("@/lib/embeddings");
    (mod.embed as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no key"));
    const results = await searchProducts({ keyword: "비타민" });
    expect(Array.isArray(results)).toBe(true);
  });
});
