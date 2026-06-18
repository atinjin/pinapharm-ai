import { NextRequest, NextResponse } from "next/server";
import { getRevision } from "@/lib/revisions";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rev = await getRevision(Number(id));
  if (!rev) return NextResponse.json({ error: "버전을 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json(rev);
}
