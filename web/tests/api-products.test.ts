import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createProduct, updateProduct, deleteProduct, listProducts } from "@/lib/products";

describe("products CRUD", () => {
  let createdId: number;

  beforeAll(async () => {
    await prisma.pharmacist.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: "김약사" } });
  });

  it("상품을 생성한다", async () => {
    const p = await createProduct({ name: "테스트영양제", price: 1000, conditionTags: ["테스트"], pharmacistId: 1 });
    createdId = p.id;
    expect(p.name).toBe("테스트영양제");
    expect(p.conditionTags).toBe('["테스트"]');
  });

  it("상품을 수정한다", async () => {
    const p = await updateProduct(createdId, { price: 2000 });
    expect(p.price).toBe(2000);
  });

  it("목록에 포함된다", async () => {
    const list = await listProducts();
    expect(list.some((x) => x.id === createdId)).toBe(true);
  });

  it("상품을 삭제한다", async () => {
    await deleteProduct(createdId);
    const list = await listProducts();
    expect(list.some((x) => x.id === createdId)).toBe(false);
  });
});
