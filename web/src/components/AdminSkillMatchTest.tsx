"use client";
import { useState } from "react";
import { scoreSkills } from "@/lib/skillMatch";
import type { AdminSkill } from "@/components/AdminSkillItem";

export function AdminSkillMatchTest({ skills }: { skills: AdminSkill[] }) {
  const [q, setQ] = useState("");
  const active = skills.filter((s) => s.isActive);
  const results = q.trim() ? scoreSkills(q, active) : [];

  const field =
    "w-full rounded-xl border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-400">
        샘플 질의에 어떤 활성 스킬이 후보로 뜨는지(설명 어휘 매칭) 미리봅니다. 실제 선택은 상담 중 에이전트가 합니다.
      </p>
      <input placeholder="예: 콧물이 나고 기침이 나요" value={q} onChange={(e) => setQ(e.target.value)} className={field} />
      {q.trim() && (
        <ul className="grid gap-2">
          {results.length === 0 && <li className="text-sm text-slate-400">매칭되는 활성 스킬이 없습니다.</li>}
          {results.map((r) => (
            <li key={r.id} className="rounded-xl bg-white/50 p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">{r.name}</span>
                <span className="ml-auto rounded-full bg-teal-50 px-2 py-0.5 text-teal-700">매칭 {r.score}</span>
              </div>
              <div className="mt-0.5 text-slate-500">{r.description}</div>
              <div className="mt-0.5 text-slate-400">매칭 토큰: {r.matched.join(", ")}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
