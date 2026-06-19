"use client";
import { useState } from "react";
import { RevisionHistory } from "@/components/RevisionHistory";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { AdminSkillDryrun } from "@/components/AdminSkillDryrun";

export type AdminSkill = {
  id: number;
  name: string;
  description: string;
  body: string;
  isActive: boolean;
};

export function AdminSkillItem({ s, onChanged }: { s: AdminSkill; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(s.description);
  const [body, setBody] = useState(s.body);
  const [active, setActive] = useState(s.isActive);
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [dryrunOpen, setDryrunOpen] = useState(false);

  async function save() {
    setBusy(true);
    await fetch(`/api/admin/skills/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, body, isActive: active }),
    });
    setBusy(false);
    setEditing(false);
    onChanged();
  }

  async function toggleActive() {
    setActive((v) => !v);
    await fetch(`/api/admin/skills/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !active }),
    });
    onChanged();
  }

  async function remove() {
    await fetch(`/api/admin/skills/${s.id}`, { method: "DELETE" });
    onChanged();
  }

  const field =
    "mt-1 block w-full rounded-lg border border-white/60 bg-white/80 px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-sky-300";

  return (
    <li className={`glass rounded-2xl p-4 transition ${!s.isActive ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate font-semibold text-slate-800">{s.name}</p>
            {!s.isActive && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">비활성</span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-500">{s.description}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={toggleActive}
            className="rounded-full border border-white/60 bg-white/60 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white/90 active:scale-95"
          >
            {s.isActive ? "비활성화" : "활성화"}
          </button>
          <button
            onClick={() => setDryrunOpen((v) => !v)}
            className="rounded-full border border-white/60 bg-white/60 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white/90 active:scale-95"
          >
            드라이런
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            className="rounded-full border border-white/60 bg-white/60 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white/90 active:scale-95"
          >
            이력
          </button>
          <button
            onClick={() => {
              setEditing((v) => !v);
              setPreview(false);
            }}
            className="rounded-full border border-white/60 bg-white/60 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white/90 active:scale-95"
          >
            {editing ? "닫기" : "수정"}
          </button>
          <button
            onClick={remove}
            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-100 active:scale-95"
          >
            삭제
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid gap-3 border-t border-white/50 pt-3">
          <label className="text-xs text-slate-500">
            설명
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
          </label>
          <div className="text-xs text-slate-500">
            <div className="flex items-center justify-between">
              <span>상담 절차 본문</span>
              <button type="button" onClick={() => setPreview((v) => !v)} className="rounded-full border border-white/60 bg-white/60 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 transition hover:bg-white/90">
                {preview ? "편집" : "미리보기"}
              </button>
            </div>
            {preview ? (
              <div className="mt-1">
                <MarkdownPreview text={body} />
              </div>
            ) : (
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className={field} />
            )}
          </div>
          <button
            onClick={save}
            disabled={busy}
            className="justify-self-end rounded-full accent px-5 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-90 active:scale-95 disabled:opacity-50"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      )}

      {dryrunOpen && <AdminSkillDryrun skillId={s.id} />}

      <RevisionHistory
        open={historyOpen}
        entityType="skill"
        entityId={String(s.id)}
        diffKey="body"
        currentText={s.body}
        onClose={() => setHistoryOpen(false)}
        onRolledBack={onChanged}
      />
    </li>
  );
}
