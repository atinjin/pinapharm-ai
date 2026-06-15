import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateSkill, deleteSkill } from "@/lib/skills";

const updateSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9가-힣]+(-[a-z0-9가-힣]+)*$/, "kebab-case 슬러그여야 합니다")
    .optional(),
  description: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json(await updateSkill(Number(id), parsed.data));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteSkill(Number(id));
  return NextResponse.json({ ok: true });
}
