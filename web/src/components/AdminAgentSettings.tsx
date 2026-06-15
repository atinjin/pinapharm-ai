"use client";
import { useEffect, useState } from "react";

type Settings = {
  persona: string;
  system_prompt: string;
  emergency_message: string;
  triage_prompt: string;
};

const FIELDS: { key: keyof Settings; label: string; hint: string; rows: number }[] = [
  { key: "persona", label: "페르소나", hint: "약사의 정체성·이름·말투", rows: 4 },
  { key: "system_prompt", label: "시스템 프롬프트", hint: "상담 원칙·규칙", rows: 12 },
  { key: "emergency_message", label: "응급 안내 메시지", hint: "응급 신호 감지 시 보낼 문구", rows: 4 },
  { key: "triage_prompt", label: "응급 분류 프롬프트", hint: "EMERGENCY/NORMAL 분류기 지시문", rows: 4 },
];

export function AdminAgentSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/agent-settings")
      .then((r) => r.json())
      .then(setSettings);
  }, []);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setSaved(false);
    await fetch("/api/admin/agent-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setBusy(false);
    setSaved(true);
  }

  if (!settings) return <p className="text-sm text-slate-400">불러오는 중…</p>;

  const field =
    "mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

  return (
    <div className="grid gap-4">
      {FIELDS.map(({ key, label, hint, rows }) => (
        <label key={key} className="block text-xs font-medium text-slate-500">
          {label} <span className="font-normal text-slate-400">· {hint}</span>
          <textarea
            value={settings[key]}
            onChange={(e) => {
              setSettings({ ...settings, [key]: e.target.value });
              setSaved(false);
            }}
            rows={rows}
            className={field}
          />
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="justify-self-start rounded-full accent px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-90 active:scale-95 disabled:opacity-50"
        >
          {busy ? "저장 중…" : "저장"}
        </button>
        {saved && <span className="text-sm text-teal-600">저장되었습니다 · 상담에 곧 반영됩니다</span>}
      </div>
    </div>
  );
}
