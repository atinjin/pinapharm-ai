import { NextRequest, NextResponse } from "next/server";
import { rollbackRevision } from "@/lib/rollback";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isFinite(n)) return NextResponse.json({ error: "유효하지 않은 버전 ID" }, { status: 400 });
  try {
    await rollbackRevision(n);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("rollback 실패", e);
    // 손상된 스냅샷·삭제된 대상 등 — 내부 오류 메시지 노출 없이 일반 안내
    return NextResponse.json(
      { error: "롤백에 실패했습니다 (대상이 변경·삭제되었거나 버전이 손상되었을 수 있습니다)" },
      { status: 400 }
    );
  }
}
