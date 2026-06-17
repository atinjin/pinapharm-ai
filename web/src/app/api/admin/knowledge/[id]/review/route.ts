import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setReviewed } from "@/lib/knowledgeAdmin";

const schema = z.object({ reviewed: z.boolean() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await setReviewed(Number(id), parsed.data.reviewed);
  return NextResponse.json({ ok: true });
}
