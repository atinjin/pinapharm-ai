"use client";
import { useState } from "react";

export function AdminSkillForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", description: "", body: "" });
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      setError("등록 실패 — 이름은 kebab-case 슬러그(예: 감기-초기-상담)여야 하며 중복될 수 없습니다.");
      return;
    }
    setForm({ name: "", description: "", body: "" });
    onCreated();
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const field =
    "w-full rounded-xl border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

  return (
    <form onSubmit={submit} className="grid gap-3">
      <input
        required
        placeholder="이름 슬러그 (예: 감기-초기-상담)"
        value={form.name}
        onChange={set("name")}
        className={field}
      />
      <input
        required
        placeholder="설명 — 언제 이 스킬을 쓰는지 (예: 콧물·기침 등 초기 감기 상담)"
        value={form.description}
        onChange={set("description")}
        className={field}
      />
      <textarea
        required
        placeholder="상담 절차 본문 (마크다운). 에이전트가 이 절차를 그대로 따릅니다."
        value={form.body}
        onChange={set("body")}
        rows={6}
        className={field}
      />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button
        type="submit"
        className="justify-self-start rounded-full accent px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-90 active:scale-95"
      >
        스킬 등록
      </button>
    </form>
  );
}
