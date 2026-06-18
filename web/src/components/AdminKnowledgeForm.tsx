"use client";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { MarkdownPreview } from "@/components/MarkdownPreview";

export type DocInitial = {
  id: number;
  category: string;
  title: string;
  body: string;
  source: Record<string, unknown>;
};

export function AdminKnowledgeForm({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: DocInitial | null; // 있으면 수정, 없으면 생성
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const [category, setCategory] = useState(initial?.category ?? "reference");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [source, setSource] = useState(
    initial?.source?.["출처"] ? String(initial.source["출처"]) : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);

  // 수정 모달이 다른 문서로 다시 열릴 때 초기값 동기화
  const [seededId, setSeededId] = useState(initial?.id ?? 0);
  if (open && (initial?.id ?? 0) !== seededId) {
    setSeededId(initial?.id ?? 0);
    setCategory(initial?.category ?? "reference");
    setTitle(initial?.title ?? "");
    setBody(initial?.body ?? "");
    setSource(initial?.source?.["출처"] ? String(initial.source["출처"]) : "");
    setError("");
    setPreview(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const payload = { category, title, body, source: source ? { 출처: source } : {} };
    const url = editing ? `/api/admin/knowledge/${initial!.id}` : "/api/admin/knowledge";
    const res = await fetch(url, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      setError("저장 실패 — 제목과 본문은 필수입니다.");
      return;
    }
    onSaved();
    onClose();
  }

  const field =
    "w-full rounded-xl border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

  return (
    <Modal open={open} title={editing ? "지식 문서 수정" : "지식 문서 추가"} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <input placeholder="카테고리 (예: reference, ingredient, note)" value={category} onChange={(e) => setCategory(e.target.value)} className={field} />
          <input placeholder="출처 (URL·저자·메모)" value={source} onChange={(e) => setSource(e.target.value)} className={field} />
        </div>
        <input required placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">본문</span>
          <button type="button" onClick={() => setPreview((v) => !v)} className="rounded-full border border-white/60 bg-white/60 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 transition hover:bg-white/90">
            {preview ? "편집" : "미리보기"}
          </button>
        </div>
        {preview ? (
          <MarkdownPreview text={body} />
        ) : (
          <textarea required placeholder="본문 — 저장 시 문단 기준으로 청크 분할·임베딩됩니다." value={body} onChange={(e) => setBody(e.target.value)} rows={10} className={field} />
        )}
        {editing && <p className="text-xs text-amber-600">본문을 바꾸면 청크가 재생성되고 검수 상태가 &lsquo;검수 필요&rsquo;로 초기화됩니다.</p>}
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-full border border-white/60 bg-white/60 px-5 py-2 text-sm font-medium text-slate-600 transition hover:bg-white/90 active:scale-95 disabled:opacity-50">취소</button>
          <button type="submit" disabled={busy} className="rounded-full accent px-5 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-90 active:scale-95 disabled:opacity-50">{busy ? "저장 중…" : editing ? "저장" : "추가"}</button>
        </div>
      </form>
    </Modal>
  );
}
