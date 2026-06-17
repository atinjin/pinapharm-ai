"use client";
import { useState } from "react";

type Hit = { id: number; documentId: number; docTitle: string; text: string; chunkIndex: number; score: number };

export function AdminKnowledgeSearchTest() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/admin/knowledge/search?q=${encodeURIComponent(q)}&k=5`);
    setHits(await res.json());
    setBusy(false);
  }

  const field =
    "w-full rounded-xl border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-400">질의를 넣으면 에이전트가 실제로 검색하게 될 청크 top-5를 보여줍니다. 잘못된 매칭을 찾아 해당 문서를 수정/삭제하세요.</p>
      <form onSubmit={run} className="flex gap-2">
        <input placeholder="예: 와파린 먹는데 오메가3 괜찮나요?" value={q} onChange={(e) => setQ(e.target.value)} className={field} />
        <button type="submit" disabled={busy} className="shrink-0 rounded-full accent px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-90 active:scale-95 disabled:opacity-50">
          {busy ? "검색 중…" : "검색"}
        </button>
      </form>
      {hits && (
        <ul className="grid gap-2">
          {hits.length === 0 && <li className="text-sm text-slate-400">검색 결과가 없습니다(색인된 문서 없음 또는 임베딩 미설정).</li>}
          {hits.map((h) => (
            <li key={h.id} className="rounded-xl bg-white/50 p-2.5 text-xs text-slate-600">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="font-semibold text-slate-700">{h.docTitle}</span>
                <span className="text-slate-400">#{h.chunkIndex}</span>
                <span className="ml-auto rounded-full bg-teal-50 px-2 py-0.5 text-teal-700">score {h.score.toFixed(3)}</span>
              </div>
              {h.text.length > 200 ? h.text.slice(0, 200) + "…" : h.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
