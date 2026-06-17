import { NextRequest, NextResponse } from "next/server";
import { reembedDocument } from "@/lib/knowledgeAdmin";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await reembedDocument(Number(id));
  return NextResponse.json({ ok: true });
}
