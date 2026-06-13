import { prisma } from "@/lib/prisma";

export function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function stringifyTags(tags: string[]): string {
  return JSON.stringify(tags);
}

type Searchable = { name: string; description?: string | null; conditionTags: string };

export function matchesQuery(p: Searchable, q: string): boolean {
  const hay = [p.name, p.description ?? "", parseTags(p.conditionTags).join(" ")]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export async function searchProducts(opts: { condition?: string; keyword?: string }) {
  const all = await prisma.product.findMany({ where: { isActive: true } });
  const terms = [opts.condition, opts.keyword].filter(Boolean) as string[];
  if (terms.length === 0) return all;
  return all.filter((p) => terms.some((t) => matchesQuery(p, t)));
}

export async function listProducts() {
  return prisma.product.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createProduct(input: {
  name: string; price: number; pharmacistId: number;
  brand?: string; description?: string; ingredients?: string;
  conditionTags?: string[]; imageUrl?: string; stock?: number;
}) {
  const { conditionTags, ...rest } = input;
  return prisma.product.create({
    data: { ...rest, conditionTags: stringifyTags(conditionTags ?? []) },
  });
}

export async function updateProduct(id: number, input: {
  name?: string; price?: number; brand?: string; description?: string;
  ingredients?: string; conditionTags?: string[]; imageUrl?: string;
  stock?: number; isActive?: boolean;
}) {
  const { conditionTags, ...rest } = input;
  return prisma.product.update({
    where: { id },
    data: { ...rest, ...(conditionTags ? { conditionTags: stringifyTags(conditionTags) } : {}) },
  });
}

export async function deleteProduct(id: number) {
  return prisma.product.delete({ where: { id } });
}

export type BulkProductInput = {
  name: string;
  price: number;
  brand?: string;
  description?: string;
  ingredients?: string;
  conditionTags?: string[];
  imageUrl?: string;
  stock?: number;
  isActive?: boolean;
};

/** 여러 상품을 한 번에 등록한다. 행 단위 실패는 모아서 보고한다. */
export async function createManyProducts(
  inputs: BulkProductInput[],
  pharmacistId = 1
): Promise<{ created: number; failed: { index: number; name: string; message: string }[] }> {
  let created = 0;
  const failed: { index: number; name: string; message: string }[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const { conditionTags, ...rest } = inputs[i];
    try {
      await prisma.product.create({
        data: { ...rest, pharmacistId, conditionTags: stringifyTags(conditionTags ?? []) },
      });
      created++;
    } catch (e) {
      failed.push({ index: i, name: inputs[i].name, message: e instanceof Error ? e.message : "unknown" });
    }
  }
  return { created, failed };
}
