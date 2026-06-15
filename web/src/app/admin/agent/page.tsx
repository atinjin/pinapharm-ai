import { AdminAgentSettings } from "@/components/AdminAgentSettings";

export default function AdminAgentPage() {
  return (
    <section className="glass rounded-3xl p-5 sm:p-6">
      <h2 className="mb-1 text-sm font-semibold text-slate-600">에이전트 설정</h2>
      <p className="mb-4 text-xs text-slate-400">맑은 약사의 페르소나·시스템 프롬프트·응급 안내를 수정합니다. 저장하면 상담에 곧 반영됩니다.</p>
      <AdminAgentSettings />
    </section>
  );
}
