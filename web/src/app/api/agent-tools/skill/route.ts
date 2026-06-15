import { NextRequest, NextResponse } from "next/server";
import { getSkillByName } from "@/lib/skills";

// 에이전트 전용 내부 도구. 활성 상담 스킬의 본문을 name으로 조회해 반환.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name이 필요합니다" }, { status: 400 });
  const skill = await getSkillByName(name);
  if (!skill) return NextResponse.json({ error: "스킬을 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json({ name: skill.name, body: skill.body });
}
