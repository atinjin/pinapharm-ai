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
