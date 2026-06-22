import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  CategoryError,
} from "@/lib/knowledgeCategories";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0, 1])),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { createDocument } from "@/lib/knowledge";

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.knowledgeCategory.deleteMany();
  await prisma.knowledgeCategory.create({
    data: { name: "미분류", displayOrder: 9999 },
  });
});

// ─── listCategories ──────────────────────────────────────────────
describe("listCategories", () => {
  it("빈 상태에서 미분류만 반환", async () => {
    const rows = await listCategories();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("미분류");
    expect(rows[0].docCount).toBe(0);
  });

  it("문서 수를 카테고리별로 집계", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "성분", displayOrder: 0 } });
    await prisma.knowledgeCategory.create({ data: { name: "참고", displayOrder: 1 } });
    await createDocument({ category: "성분", title: "비타민C", body: "항산화" });
    await createDocument({ category: "성분", title: "아연", body: "면역" });
    await createDocument({ category: "참고", title: "논문", body: "연구 결과" });

    const rows = await listCategories();
    const 성분 = rows.find((r) => r.name === "성분")!;
    const 참고 = rows.find((r) => r.name === "참고")!;
    expect(성분.docCount).toBe(2);
    expect(참고.docCount).toBe(1);
  });

  it("displayOrder ASC로 정렬", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "Z카테", displayOrder: 10 } });
    await prisma.knowledgeCategory.create({ data: { name: "A카테", displayOrder: 0 } });
    const rows = await listCategories();
    const names = rows.filter((r) => r.name !== "미분류").map((r) => r.name);
    expect(names[0]).toBe("A카테");
  });
});

// ─── createCategory ──────────────────────────────────────────────
describe("createCategory", () => {
  it("정상 생성", async () => {
    const cat = await createCategory({
      name: "성분",
      description: "원료 관련",
      icon: "🌿",
      color: "bg-emerald-100 text-emerald-700",
      displayOrder: 1,
    });
    expect(cat.name).toBe("성분");
    expect(cat.icon).toBe("🌿");
  });

  it("중복 이름 → DUPLICATE_NAME", async () => {
    await createCategory({ name: "성분" });
    await expect(createCategory({ name: "성분" })).rejects.toMatchObject({
      code: "DUPLICATE_NAME",
    });
  });
});

// ─── updateCategory ──────────────────────────────────────────────
describe("updateCategory", () => {
  it("이름·아이콘·색상·설명·순서 수정", async () => {
    const cat = await createCategory({ name: "구카테", displayOrder: 0 });
    const updated = await updateCategory(cat.id, {
      name: "신카테",
      icon: "💊",
      color: "bg-blue-100 text-blue-700",
      description: "설명",
      displayOrder: 5,
    });
    expect(updated.name).toBe("신카테");
    expect(updated.icon).toBe("💊");
    expect(updated.displayOrder).toBe(5);
  });

  it("이름 변경 시 해당 카테고리 문서 cascade 업데이트", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "구카테" } });
    await createDocument({ category: "구카테", title: "문서1", body: "내용" });
    await createDocument({ category: "구카테", title: "문서2", body: "내용" });

    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "구카테" } });
    await updateCategory(cat!.id, { name: "신카테" });

    const docs = await prisma.knowledgeDocument.findMany({ where: { category: "신카테" } });
    expect(docs).toHaveLength(2);
    const old = await prisma.knowledgeDocument.findMany({ where: { category: "구카테" } });
    expect(old).toHaveLength(0);
  });

  it("'미분류' 카테고리 이름 변경 → PROTECTED", async () => {
    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "미분류" } });
    await expect(updateCategory(cat!.id, { name: "다른이름" })).rejects.toMatchObject({
      code: "PROTECTED",
    });
  });

  it("다른 카테고리를 '미분류'로 이름 변경 → PROTECTED", async () => {
    const cat = await createCategory({ name: "성분" });
    await expect(updateCategory(cat.id, { name: "미분류" })).rejects.toMatchObject({
      code: "PROTECTED",
    });
  });

  it("없는 id → NOT_FOUND", async () => {
    await expect(updateCategory(999999, { name: "X" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ─── deleteCategory ──────────────────────────────────────────────
describe("deleteCategory", () => {
  it("문서 없는 카테고리 삭제, movedCount=0", async () => {
    const cat = await createCategory({ name: "빈카테" });
    const result = await deleteCategory(cat.id);
    expect(result.movedCount).toBe(0);
    const gone = await prisma.knowledgeCategory.findUnique({ where: { id: cat.id } });
    expect(gone).toBeNull();
  });

  it("문서 있는 카테고리 삭제 → 문서 '미분류'로 이동", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "성분" } });
    await createDocument({ category: "성분", title: "루테인", body: "눈 건강" });
    await createDocument({ category: "성분", title: "아연", body: "면역" });

    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "성분" } });
    const result = await deleteCategory(cat!.id);
    expect(result.movedCount).toBe(2);

    const moved = await prisma.knowledgeDocument.findMany({ where: { category: "미분류" } });
    expect(moved).toHaveLength(2);
  });

  it("'미분류' 삭제 → PROTECTED", async () => {
    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "미분류" } });
    await expect(deleteCategory(cat!.id)).rejects.toMatchObject({ code: "PROTECTED" });
  });

  it("없는 id → NOT_FOUND", async () => {
    await expect(deleteCategory(999999)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
