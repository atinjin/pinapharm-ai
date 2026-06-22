import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listCategories, createCategory, CategoryError, categoryStatus } from "@/lib/knowledgeCategories";

export async function GET(_req: NextRequest) {
  const rows = await listCategories();
  return NextResponse.json({ rows });
}

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  displayOrder: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const cat = await createCategory(parsed.data);
    return NextResponse.json(cat, { status: 201 });
  } catch (e) {
    if (e instanceof CategoryError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: categoryStatus(e.code) });
    return NextResponse.json({ error: "카테고리 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
