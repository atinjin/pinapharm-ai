"use client";
import { useStore } from "@/components/store/StoreProvider";
import { ProductCard } from "@/components/ProductCard";

export function Storefront() {
  const { display, loading, query, matchedIds, allTags, ask, clearSearch } = useStore();
  const matched = new Set(matchedIds);
  const searching = !!query && matchedIds.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* panel header (fixed) */}
      <div className="shrink-0 px-5 pb-3 pt-5">
        {searching ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold text-slate-900">
              <span className="text-spark">✦ &ldquo;{query}&rdquo;</span> 추천 상품
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{matchedIds.length}</span>
            <button onClick={clearSearch} className="text-xs text-slate-400 transition hover:text-slate-700">
              전체 보기 ✕
            </button>
          </div>
        ) : (
          <h2 className="text-[15px] font-bold text-slate-900">전체 영양제</h2>
        )}

        {allTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {allTags.slice(0, 8).map((t) => (
              <button
                key={t}
                onClick={() => ask(t)}
                className={`rounded-full px-3 py-1 text-[13px] transition ${
                  query === t ? "accent text-white" : "surface text-slate-600 hover:bg-slate-50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* grid (scrolls) */}
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-1">
        {loading ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-7">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-[20px] bg-slate-100" />
            ))}
          </div>
        ) : display.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">등록된 영양제가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-7">
            {display.map((p) => (
              <ProductCard key={p.id} p={p} recommended={searching && matched.has(p.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
