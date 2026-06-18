import { NextRequest, NextResponse } from "next/server";
import { rollbackRevision } from "@/lib/rollback";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await rollbackRevision(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "롤백 실패" }, { status: 400 });
  }
}
