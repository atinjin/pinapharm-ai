"use client";
import { useState } from "react";
import { MarkdownPreview } from "@/components/MarkdownPreview";

export function AdminSkillDryrun({ skillId }: { skillId: number }) {
  const [q, setQ] = useState("");
  const [resp, setResp] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    setErr("");
    setResp(null);
    const res = await fetch("/api/admin/skills/dryrun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId, query: q }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setErr(data.error ? (typeof data.error === "string" ? data.error : "드라이런 실패") : "드라이런 실패");
      return;
    }
    setResp(data.response ?? "");
  }

  const field =
    "w-full rounded-xl border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

  return (
    <div className="mt-3 grid gap-2 border-t border-white/50 pt-3">
      <p className="text-xs text-slate-400">샘플 질의에 이 스킬을 주입해 Claude 응답을 미리봅니다(1회 호출·비용·비결정적).</p>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 콧물이 나고 기침이 나요" className={field} />
        <button
          onClick={run}
          disabled={busy}
          className="shrink-0 rounded-full accent px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-90 active:scale-95 disabled:opacity-50"
        >
          {busy ? "실행 중…" : "드라이런"}
        </button>
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {resp !== null && <MarkdownPreview text={resp} />}
    </div>
  );
}
