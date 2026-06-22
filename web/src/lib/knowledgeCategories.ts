import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export class CategoryError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "PROTECTED" | "DUPLICATE_NAME",
    message: string
  ) {
    super(message);
    this.name = "CategoryError";
  }
}

export function categoryStatus(code: CategoryError["code"]): number {
  const map: Record<CategoryError["code"], number> = {
    NOT_FOUND: 404,
    PROTECTED: 403,
    DUPLICATE_NAME: 409,
  };
  return map[code];
}

export type CategoryRow = {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  displayOrder: number;
  docCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CategoryInput = {
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  displayOrder?: number;
};

export async function listCategories(): Promise<CategoryRow[]> {
  const [cats, counts] = await Promise.all([
    prisma.knowledgeCategory.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.knowledgeDocument.groupBy({ by: ["category"], _count: { id: true } }),
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [c.category, c._count.id]));
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    icon: c.icon,
    color: c.color,
    displayOrder: c.displayOrder,
    docCount: countMap[c.name] ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

export async function createCategory(input: CategoryInput) {
  try {
    return await prisma.knowledgeCategory.create({
      data: {
        name: input.name,
        description: input.description,
        icon: input.icon,
        color: input.color,
        displayOrder: input.displayOrder ?? 0,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new CategoryError("DUPLICATE_NAME", `'${input.name}' 카테고리가 이미 존재합니다.`);
    }
    throw e;
  }
}

export async function updateCategory(id: number, input: Partial<CategoryInput>) {
  return prisma.$transaction(async (tx) => {
    const cat = await tx.knowledgeCategory.findUnique({ where: { id } });
    if (!cat) throw new CategoryError("NOT_FOUND", "카테고리를 찾을 수 없습니다.");

    if (input.name !== undefined) {
      if (cat.name === "미분류") {
        throw new CategoryError("PROTECTED", "미분류 카테고리는 이름을 변경할 수 없습니다.");
      }
      if (input.name === "미분류") {
        throw new CategoryError("PROTECTED", "미분류는 시스템 카테고리 이름입니다.");
      }
      if (input.name !== cat.name) {
        await tx.knowledgeDocument.updateMany({
          where: { category: cat.name },
          data: { category: input.name },
        });
      }
    }

    try {
      return await tx.knowledgeCategory.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          icon: input.icon,
          color: input.color,
          displayOrder: input.displayOrder,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new CategoryError("DUPLICATE_NAME", `'${input.name}' 카테고리가 이미 존재합니다.`);
      }
      throw e;
    }
  });
}

export async function deleteCategory(id: number): Promise<{ movedCount: number }> {
  return prisma.$transaction(async (tx) => {
    const cat = await tx.knowledgeCategory.findUnique({ where: { id } });
    if (!cat) throw new CategoryError("NOT_FOUND", "카테고리를 찾을 수 없습니다.");
    if (cat.name === "미분류") {
      throw new CategoryError("PROTECTED", "미분류 카테고리는 삭제할 수 없습니다.");
    }
    const moved = await tx.knowledgeDocument.updateMany({
      where: { category: cat.name },
      data: { category: "미분류" },
    });
    await tx.knowledgeCategory.delete({ where: { id } });
    return { movedCount: moved.count };
  });
}
