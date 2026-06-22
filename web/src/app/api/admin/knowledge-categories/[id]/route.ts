import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateCategory, deleteCategory, CategoryError, categoryStatus } from "@/lib/knowledgeCategories";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  displayOrder: z.number().int().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const cat = await updateCategory(Number(id), parsed.data);
    return NextResponse.json(cat);
  } catch (e) {
    if (e instanceof CategoryError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: categoryStatus(e.code) });
    return NextResponse.json({ error: "카테고리 수정 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await deleteCategory(Number(id));
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof CategoryError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: categoryStatus(e.code) });
    return NextResponse.json({ error: "카테고리 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }
}
