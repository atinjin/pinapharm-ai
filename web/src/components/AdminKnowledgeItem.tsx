"use client";
import { useState } from "react";
import type { DocInitial } from "@/components/AdminKnowledgeForm";

export type KnowledgeDocRow = {
  id: number;
  category: string;
  title: string;
  source: Record<string, unknown>;
  reviewedAt: string | null;
  chunkCount: number;
  staleCount: number;
  updatedAt: string;
};

type Chunk = { id: number; chunkIndex: number; text: string; embeddingStale: boolean; model: string };

export function AdminKnowledgeItem({
  doc,
  onChanged,
  onEdit,
  onRequestDelete,
}: {
  doc: KnowledgeDocRow;
  onChanged: () => void;
  onEdit: (d: DocInitial) => void;
  onRequestDelete: (d: KnowledgeDocRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [busy, setBusy] = useState(false);
  const reviewed = !!doc.reviewedAt;

  async function toggleChunks() {
    if (!open && !chunks) {
      const res = await fetch(`/api/admin/knowledge/${doc.id}`);
      const full = await res.json();
      setChunks(full.chunks ?? []);
    }
    setOpen((v) => !v);
  }
  async function startEdit() {
    const res = await fetch(`/api/admin/knowledge/${doc.id}`);
    const full = await res.json();
    onEdit({ id: full.id, category: full.category, title: full.title, body: full.body, source: full.source ?? {} });
  }
  async function toggleReviewed() {
    setBusy(true);
    await fetch(`/api/admin/knowledge/${doc.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewed: !reviewed }),
    });
    setBusy(false);
    onChanged();
  }
  async function reembed() {
    setBusy(true);
    await fetch(`/api/admin/knowledge/${doc.id}/reembed`, { method: "POST" });
    setBusy(false);
    setChunks(null);
    onChanged();
  }

  const pill = "rounded-full px-2 py-0.5 text-[11px] font-medium";
  const btn =
    "rounded-full border border-white/60 bg-white/60 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white/90 active:scale-95 disabled:opacity-50";

  return (
    <li className="glass rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate font-semibold text-slate-800">{doc.title}</p>
            <span className={`${pill} bg-slate-100 text-slate-500`}>{doc.category}</span>
            <span className={`${pill} ${reviewed ? "bg-teal-50 text-teal-700" : "bg-amber-100 text-amber-700"}`}>
              {reviewed ? "검수완료" : "검수필요"}
            </span>
            {doc.staleCount > 0 && (
              <span className={`${pill} bg-rose-50 text-rose-600`}>임베딩 {doc.staleCount} 미완</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            청크 {doc.chunkCount}개
            {doc.source?.["출처"] ? ` · 출처: ${String(doc.source["출처"])}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button onClick={toggleChunks} className={btn}>{open ? "청크 닫기" : `청크 보기`}</button>
          <button onClick={startEdit} className={btn}>수정</button>
          <button onClick={toggleReviewed} disabled={busy} className={btn}>{reviewed ? "검수 해제" : "검수 완료"}</button>
          {doc.staleCount > 0 && (
            <button onClick={reembed} disabled={busy} className={btn}>임베딩 재생성</button>
          )}
          <button
            onClick={() => onRequestDelete(doc)}
            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-100 active:scale-95"
          >
            삭제
          </button>
        </div>
      </div>

      {open && chunks && (
        <ul className="mt-3 grid gap-2 border-t border-white/50 pt-3">
          {chunks.map((c) => (
            <li key={c.id} className="rounded-xl bg-white/50 p-2 text-xs text-slate-600">
              <span className="mr-2 font-medium text-slate-400">#{c.chunkIndex}</span>
              {c.embeddingStale && <span className="mr-2 text-rose-500">[임베딩 미완]</span>}
              {c.text.length > 200 ? c.text.slice(0, 200) + "…" : c.text}
            </li>
          ))}
          {chunks.length === 0 && <li className="text-xs text-slate-400">청크가 없습니다.</li>}
        </ul>
      )}
    </li>
  );
}
