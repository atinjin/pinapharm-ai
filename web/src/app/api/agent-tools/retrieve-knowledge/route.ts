import { NextRequest, NextResponse } from "next/server";
import { retrieve } from "@/lib/knowledge";

// 에이전트 전용 내부 도구. 원료 지식을 의미 기반으로 검색해 근거를 반환.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  const k = Number(req.nextUrl.searchParams.get("k") ?? "4");
  if (!q) return NextResponse.json({ error: "q가 필요합니다" }, { status: 400 });
  try {
    const hits = await retrieve(q, "ingredient", Number.isFinite(k) ? k : 4);
    return NextResponse.json(hits);
  } catch {
    // 임베딩 실패 등 → 근거 없음(채팅은 계속)
    return NextResponse.json([]);
  }
}
