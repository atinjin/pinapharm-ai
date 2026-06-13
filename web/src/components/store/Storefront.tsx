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
    <div className="flex flex-col gap-6">
      {/* hero conversational search */}
      <section className="glass rounded-[28px] p-6 sm:p-8">
        <div className="mx-auto max-w-xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/60 px-3 py-1 text-xs font-medium text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> AI 약사 추천 스토어
          </span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-800 sm:text-3xl">
            증상만 말하면, 약사가 골라드려요
          </h1>
          <p className="mt-2 text-sm text-slate-500">건강 고민을 입력하면 맞는 영양제를 진열에서 바로 찾아드립니다.</p>

          <form onSubmit={submit} className="mt-5">
            <div className="flex items-center gap-2 rounded-full border border-white/60 bg-white/80 py-2 pl-5 pr-2 shadow-sm transition focus-within:border-sky-300 focus-within:bg-white">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="예: 요즘 너무 피곤하고 눈이 침침해요"
                className="flex-1 bg-transparent py-1.5 text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
              />
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-teal-500 to-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-sky-500/30 transition hover:opacity-90 active:scale-95"
              >
                약사에게 묻기
              </button>
            </div>
          </form>

          {/* tag filter chips */}
          {allTags.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                onClick={clearSearch}
                className={`rounded-full px-3.5 py-1.5 text-sm transition ${
                  !query ? "bg-slate-800 text-white" : "border border-white/60 bg-white/50 text-slate-600 hover:bg-white/80"
                }`}
              >
                전체
              </button>
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => ask(t)}
                  className={`rounded-full px-3.5 py-1.5 text-sm transition ${
                    query === t
                      ? "bg-gradient-to-r from-teal-500 to-sky-500 text-white shadow"
                      : "border border-white/60 bg-white/50 text-slate-600 hover:bg-white/80"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* result header */}
      <div className="flex items-center justify-between px-1">
        {searching ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gradient-to-r from-teal-500 to-sky-500 bg-clip-text text-sm font-bold text-transparent">
              ✦ &ldquo;{query}&rdquo; 추천 결과
            </span>
            <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-medium text-slate-500">{matchedIds.length}개</span>
            <button onClick={clearSearch} className="text-xs text-slate-400 underline-offset-2 hover:underline">
              전체 보기 ✕
            </button>
          </div>
        ) : (
          <h2 className="text-sm font-semibold text-slate-600">전체 영양제</h2>
        )}
      </div>

      {/* grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass h-64 animate-pulse rounded-3xl opacity-60" />
          ))}
        </div>
      ) : display.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">등록된 영양제가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {display.map((p) => (
            <ProductCard key={p.id} p={p} recommended={searching && matched.has(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
