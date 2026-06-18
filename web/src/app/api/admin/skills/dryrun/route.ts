import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const schema = z.object({ skillId: z.number().int(), query: z.string().min(1) });
const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8000";

// 스킬 LLM 드라이런: 스킬 본문 + 샘플 질의를 에이전트 /skill-dryrun으로 보내 Claude 응답을 받아온다.
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const skill = await prisma.consultationSkill.findUnique({ where: { id: parsed.data.skillId } });
  if (!skill) return NextResponse.json({ error: "스킬을 찾을 수 없습니다" }, { status: 404 });
  try {
    const res = await fetch(`${AGENT_URL}/skill-dryrun`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: parsed.data.query, skill_body: skill.body, skill_name: skill.name }),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data.error ?? "드라이런 실패" }, { status: 502 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "에이전트에 연결할 수 없습니다 (실행 중인지 확인)" }, { status: 502 });
  }
}
