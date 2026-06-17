import { NextRequest, NextResponse } from "next/server";
import { searchChunks } from "@/lib/knowledgeAdmin";

// 검색 테스트: 질의로 실제 검색되는 청크 top-k를 미리보기.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  const k = Number(req.nextUrl.searchParams.get("k") ?? "5");
  if (!q) return NextResponse.json({ error: "q가 필요합니다" }, { status: 400 });
  try {
    return NextResponse.json(await searchChunks(q, Number.isFinite(k) ? k : 5));
  } catch {
    return NextResponse.json([]);
  }
}
