"use client";
import { useEffect, useState } from "react";
import { AdminSkillForm } from "@/components/AdminSkillForm";
import { AdminSkillItem, type AdminSkill } from "@/components/AdminSkillItem";

export default function AdminSkillsPage() {
  const [skills, setSkills] = useState<AdminSkill[]>([]);

  async function loadSkills() {
    const res = await fetch("/api/admin/skills");
    setSkills(await res.json());
  }
  useEffect(() => {
    loadSkills();
  }, []);

  return (
    <>
      <section className="glass mb-5 rounded-3xl p-5 sm:p-6">
        <h2 className="mb-1 text-sm font-semibold text-slate-600">새 상담 스킬 등록</h2>
        <p className="mb-4 text-xs text-slate-400">특정 상담 상황의 절차를 등록하면, 에이전트가 해당 상황에서 절차를 불러와 따릅니다.</p>
        <AdminSkillForm onCreated={loadSkills} />
      </section>

      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-slate-600">등록된 상담 스킬</h2>
        <span className="rounded-full bg-white/60 px-2.5 py-0.5 text-xs font-medium text-slate-500">{skills.length}개</span>
      </div>

      <ul className="grid gap-3">
        {skills.map((s) => (
          <AdminSkillItem key={s.id} s={s} onChanged={loadSkills} />
        ))}
      </ul>
    </>
  );
}
