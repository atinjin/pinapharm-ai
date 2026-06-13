"use client";
import { useState } from "react";
import { useStore } from "@/components/store/StoreProvider";
import { ProductCard } from "@/components/ProductCard";

export function Storefront() {
  const { display, loading, query, matchedIds, allTags, ask, clearSearch } = useStore();
  const [text, setText] = useState("");
  const matched = new Set(matchedIds);
  const searching = !!query && matchedIds.length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    ask(text);
    setText("");
  }

  return (
    <div className="flex flex-col gap-7">
      {/* hero search (Gemini-style) */}
      <section className="pt-2 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
          <span className="spark flex h-12 w-12 items-center justify-center rounded-2xl text-2xl text-white shadow-sm">✦</span>
        </div>
        <h1 className="text-[26px] font-bold tracking-tight text-slate-900 sm:text-[30px]">
          <span className="text-spark">맑은 약사</span>에게 물어보세요
        </h1>
        <p className="mx-auto mt-2.5 max-w-md text-[15px] leading-relaxed text-slate-500">
          증상을 말하면 맞는 영양제를 진열에서 찾아드려요.
        </p>

        <form onSubmit={submit} className="mx-auto mt-6 max-w-xl">
          <div className="surface flex items-center gap-2 rounded-full py-2 pl-5 pr-2 transition focus-within:border-indigo-300 focus-within:shadow-md">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="예: 요즘 너무 피곤해요"
              className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              aria-label="검색"
              className="accent flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition hover:opacity-90 active:scale-95 disabled:opacity-40"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </form>

        {allTags.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              onClick={clearSearch}
              className={`rounded-full px-3.5 py-1.5 text-sm transition ${
                !query ? "bg-slate-900 text-white" : "surface text-slate-600 hover:bg-slate-50"
              }`}
            >
              전체
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                onClick={() => ask(t)}
                className={`rounded-full px-3.5 py-1.5 text-sm transition ${
                  query === t ? "accent text-white" : "surface text-slate-600 hover:bg-slate-50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* result header */}
      <div className="flex min-h-[24px] items-center justify-between">
        {searching ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[15px] font-bold text-slate-900">
              <span className="text-spark">✦ &ldquo;{query}&rdquo;</span> 추천 결과
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{matchedIds.length}</span>
            <button onClick={clearSearch} className="text-xs text-slate-400 transition hover:text-slate-700">
              전체 보기 ✕
            </button>
          </div>
        ) : (
          <h2 className="text-[15px] font-semibold text-slate-700">전체 영양제</h2>
        )}
      </div>

      {/* grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-[20px] bg-slate-100" />
          ))}
        </div>
      ) : display.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">등록된 영양제가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3">
          {display.map((p) => (
            <ProductCard key={p.id} p={p} recommended={searching && matched.has(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
