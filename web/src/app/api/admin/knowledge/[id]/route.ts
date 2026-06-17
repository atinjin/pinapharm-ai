import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDocument, updateDocument, deleteDocument } from "@/lib/knowledgeAdmin";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(Number(id));
  if (!doc) return NextResponse.json({ error: "문서를 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json(doc);
}

const updateSchema = z.object({
  category: z.string().optional(),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  source: z.record(z.string(), z.unknown()).optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json(await updateDocument(Number(id), parsed.data));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteDocument(Number(id));
  return NextResponse.json({ ok: true });
}
