import { NextResponse } from "next/server";
import { getAgentSettings } from "@/lib/agentConfig";
import { listActiveSkills } from "@/lib/skills";

// 에이전트(FastAPI)가 매 요청 시 호출하는 내부 설정 엔드포인트.
// 스킬은 카탈로그(name·description)만 반환하고 본문은 /api/agent-tools/skill로 온디맨드 로드한다.
export async function GET() {
  const [settings, skills] = await Promise.all([getAgentSettings(), listActiveSkills()]);
  return NextResponse.json({
    persona: settings.persona,
    systemPrompt: settings.system_prompt,
    emergencyMessage: settings.emergency_message,
    triagePrompt: settings.triage_prompt,
    skills: skills.map((s) => ({ name: s.name, description: s.description })),
  });
}
