import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listSkills, createSkill } from "@/lib/skills";

export async function GET() {
  return NextResponse.json(await listSkills());
}

const createSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9가-힣]+(-[a-z0-9가-힣]+)*$/, "kebab-case 슬러그여야 합니다"),
  description: z.string().min(1),
  body: z.string().min(1),
  isActive: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json(await createSkill(parsed.data), { status: 201 });
}
