"use client";
import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { AdminKnowledgeForm, type DocInitial } from "@/components/AdminKnowledgeForm";
import { AdminKnowledgeItem, type KnowledgeDocRow } from "@/components/AdminKnowledgeItem";
import { AdminKnowledgeSearchTest } from "@/components/AdminKnowledgeSearchTest";

export default function AdminKnowledgePage() {
  const [rows, setRows] = useState<KnowledgeDocRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [reviewed, setReviewed] = useState("");
  const [q, setQ] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<DocInitial | null>(null);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeDocRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    if (category) sp.set("category", category);
    if (reviewed) sp.set("reviewed", reviewed);
    if (q.trim()) sp.set("q", q.trim());
    sp.set("page", String(page));
    const res = await fetch(`/api/admin/knowledge?${sp.toString()}`);
    const data = await res.json();
    setRows(data.rows);
    setTotal(data.total);
    setPageSize(data.pageSize);
  }, [category, reviewed, q, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [category, reviewed, q]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    await fetch(`/api/admin/knowledge/${pendingDelete.id}`, { method: "DELETE" });
    setDeleting(false);
    setPendingDelete(null);
    load();
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const field =
    "w-full rounded-xl border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

  return (
    <>
      <section className="glass mb-5 rounded-3xl p-5 sm:p-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-600">검색 테스트</h2>
        <AdminKnowledgeSearchTest />
      </section>

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => {
            setEditDoc(null);
            setFormOpen(true);
          }}
          className="rounded-full accent px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-90 active:scale-95"
        >
          + 지식 문서 추가
        </button>
      </div>

      <AdminKnowledgeForm open={formOpen} initial={editDoc} onClose={() => setFormOpen(false)} onSaved={load} />

      <Modal open={!!pendingDelete} title="지식 문서 삭제 확인" onClose={() => !deleting && setPendingDelete(null)}>
        {pendingDelete && (
          <div className="grid gap-4">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-800">{pendingDelete.title}</span> 문서와 청크 {pendingDelete.chunkCount}개를 삭제합니다. 되돌릴 수 없습니다.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingDelete(null)} disabled={deleting} className="rounded-full border border-white/60 bg-white/60 px-5 py-2 text-sm font-medium text-slate-600 transition hover:bg-white/90 active:scale-95 disabled:opacity-50">취소</button>
              <button onClick={confirmDelete} disabled={deleting} className="rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-rose-500/30 transition hover:bg-rose-600 active:scale-95 disabled:opacity-50">{deleting ? "삭제 중…" : "삭제"}</button>
            </div>
          </div>
        )}
      </Modal>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input placeholder="제목·본문 검색" value={q} onChange={(e) => setQ(e.target.value)} className={field} />
        <input placeholder="카테고리" value={category} onChange={(e) => setCategory(e.target.value)} className={`${field} sm:w-40`} />
        <select value={reviewed} onChange={(e) => setReviewed(e.target.value)} className={`${field} sm:w-40`} aria-label="검수 상태">
          <option value="">전체</option>
          <option value="false">검수 필요</option>
          <option value="true">검수 완료</option>
        </select>
      </div>

      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-slate-600">지식 문서</h2>
        <span className="rounded-full bg-white/60 px-2.5 py-0.5 text-xs font-medium text-slate-500">{total}개</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-1 py-6 text-sm text-slate-400">문서가 없습니다. &lsquo;지식 문서 추가&rsquo;로 등록하세요.</p>
      ) : (
        <>
          <ul className="grid gap-3">
            {rows.map((d) => (
              <AdminKnowledgeItem
                key={d.id}
                doc={d}
                onChanged={load}
                onEdit={(full) => {
                  setEditDoc(full);
                  setFormOpen(true);
                }}
                onRequestDelete={setPendingDelete}
              />
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-center gap-3">
              <button onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page <= 1} className="rounded-full border border-white/60 bg-white/60 px-4 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white/90 active:scale-95 disabled:opacity-40">이전</button>
              <span className="text-sm text-slate-500">{page} / {totalPages}</span>
              <button onClick={() => setPage((n) => Math.min(totalPages, n + 1))} disabled={page >= totalPages} className="rounded-full border border-white/60 bg-white/60 px-4 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white/90 active:scale-95 disabled:opacity-40">다음</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
