import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0, 1])), // 의미경로 무력화(필터·lexical만 검증)
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { searchProducts } from "@/lib/products";

let ids: number[] = [];
const tag = `구조화테스트_${Date.now()}`;

beforeEach(async () => {
  const mk = (data: Record<string, unknown>) =>
    prisma.product.create({ data: { pharmacistId: 1, price: 1000, conditionTags: "[]", name: tag, ...data } });
  const p1 = await mk({ name: `${tag} 정`, form: "정", doseAmount: 300, doseUnit: "mg", ingredients: "마그네슘" });
  const p2 = await mk({ name: `${tag} 캡슐`, form: "캡슐", doseAmount: 200, doseUnit: "mg", ingredients: "마그네슘, 유당" });
  const p3 = await mk({ name: `${tag} 분말`, ingredients: "마그네슘" }); // form/dose 미입력(null)
  ids = [p1.id, p2.id, p3.id];
});

afterEach(async () => {
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
});

describe("searchProducts structured criteria", () => {
  it("form filter excludes known mismatches, keeps nulls", async () => {
    const r = await searchProducts({ keyword: tag, form: "정" });
    const got = new Set(r.map((p) => p.id));
    expect(got.has(ids[0])).toBe(true); // 정
    expect(got.has(ids[2])).toBe(true); // form=null → 유지
    expect(got.has(ids[1])).toBe(false); // 캡슐 → 제외
  });

  it("minDose excludes products below the threshold (nulls kept)", async () => {
    const r = await searchProducts({ keyword: tag, minDose: 300 });
    const got = new Set(r.map((p) => p.id));
    expect(got.has(ids[0])).toBe(true); // 300
    expect(got.has(ids[2])).toBe(true); // dose=null → 유지
    expect(got.has(ids[1])).toBe(false); // 200 < 300 → 제외
  });

  it("excludeAllergens hard-excludes matching products", async () => {
    const r = await searchProducts({ keyword: tag, excludeAllergens: ["유당"] });
    const got = new Set(r.map((p) => p.id));
    expect(got.has(ids[1])).toBe(false); // 유당 포함 → 제외
    expect(got.has(ids[0])).toBe(true);
    expect(got.has(ids[2])).toBe(true);
  });
});
