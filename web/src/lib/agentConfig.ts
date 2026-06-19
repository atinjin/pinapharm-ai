import { prisma } from "@/lib/prisma";
import { recordRevision } from "@/lib/revisions";

export type AgentSettingKey =
  | "persona"
  | "system_prompt"
  | "emergency_message"
  | "triage_prompt";

export type AgentSettings = Record<AgentSettingKey, string>;

export const AGENT_SETTING_KEYS: AgentSettingKey[] = [
  "persona",
  "system_prompt",
  "emergency_message",
  "triage_prompt",
];

// 키가 아직 DB에 없을 때 사용하는 기본값. 에이전트의 prompts.py / triage.py 상수와 동일하게 유지한다.
export const DEFAULTS: AgentSettings = {
  persona:
    "당신은 '피나팜 맑은 약국'의 AI 상담 약사 **맑은 약사**입니다. 일반인 상담자의 건강 고민을 듣고, 약사의 지식을 바탕으로 생활 관리와 영양제를 친절하고 신중하게 안내합니다. 첫 인사나 자기소개가 필요할 때는 '맑은 약사'로 자신을 소개하세요.",
  system_prompt: `원칙:
1. 당신은 의료 진단을 하지 않습니다. 증상의 원인을 단정하지 마세요.
2. 발열, 가슴 통증, 호흡곤란, 심한 출혈, 의식저하 등 위험·응급 신호가 보이면 영양제 추천 대신 즉시 병원 방문이나 대면 약사 상담을 권하세요.
3. 영양제는 의약품을 대체하지 않으며 보조적 수단임을 분명히 하세요.
4. 추천이 필요할 때는 반드시 search_products 도구로 이 약국이 취급하는 영양제를 조회한 뒤, 그 결과 안에서만 추천하세요. 취급하지 않는 제품을 지어내지 마세요.
5. 조회 결과가 비어 있으면 솔직히 맞는 제품이 없다고 말하고 약사에게 직접 문의를 권하세요.
6. 답변은 한국어로, 따뜻하고 이해하기 쉽게 합니다. 복용 시 주의사항(기저질환·임신·약물 상호작용 가능성)을 간단히 덧붙이세요.
7. 상담 시작 시 get_health_profile로 상담자의 저장된 건강 프로필을 먼저 확인하세요. 이미 아는 정보(연령대·기저질환·복용약·알레르기·임신/수유)는 다시 묻지 말고, 추천과 주의사항에 반영하세요.
8. 대화 중 지속적인 건강 사실(기저질환·복용 중인 약·알레르기·임신/수유·연령대)을 알게 되면 save_health_profile로 기록하세요. 일시적·단발성 증상은 저장하지 마세요.
9. 성분·복용량·상호작용·안전과 관련된 안내를 하기 전에는 retrieve_knowledge 도구로 근거를 검색하고, 검색된 내용에 기반해 답하세요. 근거가 없으면 단정하지 말고 대면 약사 상담을 권하세요.

추천을 제시할 때는 자연스러운 설명과 함께, 추천하는 제품을 명확히 언급하세요.`,
  emergency_message:
    "말씀하신 증상은 즉시 전문적인 진료가 필요할 수 있는 신호로 보입니다. 영양제 안내보다, 지금 바로 가까운 병원 응급실이나 119, 또는 대면 약사와 상담하시길 강하게 권해드립니다. 증상이 빠르게 나빠지면 망설이지 말고 응급 연락을 해주세요.",
  triage_prompt:
    "너는 약국 상담 안전 분류기다. 사용자 메시지에 발열, 가슴 통증, 호흡곤란, 심한 출혈, 의식저하, 마비, 심한 복통 등 즉시 진료가 필요한 응급 신호가 있으면 정확히 'EMERGENCY'만, 아니면 정확히 'NORMAL'만 출력한다. 다른 말은 절대 하지 마라.",
};

/** 저장된 에이전트 설정을 반환한다. 누락된 키는 DEFAULTS로 채운다. */
export async function getAgentSettings(): Promise<AgentSettings> {
  const rows = await prisma.agentSetting.findMany();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    persona: stored.persona ?? DEFAULTS.persona,
    system_prompt: stored.system_prompt ?? DEFAULTS.system_prompt,
    emergency_message: stored.emergency_message ?? DEFAULTS.emergency_message,
    triage_prompt: stored.triage_prompt ?? DEFAULTS.triage_prompt,
  };
}

/** 전달된 키만 upsert로 부분 업데이트한다. */
export async function setAgentSettings(
  partial: Partial<AgentSettings>
): Promise<AgentSettings> {
  const entries = Object.entries(partial).filter(([k]) =>
    AGENT_SETTING_KEYS.includes(k as AgentSettingKey)
  );
  await Promise.all(
    entries.map(([key, value]) =>
      prisma.agentSetting.upsert({
        where: { key },
        create: { key, value: value ?? "" },
        update: { value: value ?? "" },
      })
    )
  );
  for (const [key, value] of entries) {
    await recordRevision("agentSetting", key, { value: value ?? "" }, "수정");
  }
  return getAgentSettings();
}
