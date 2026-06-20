"use client";
import { useMemo } from "react";
import { useStore } from "@/components/store/StoreProvider";
import { ProductCard } from "@/components/ProductCard";

export function Storefront() {
  const { all, loading, query, matchedIds, cartCount, setCartOpen } = useStore();

  // 추천(매칭) 영양제만, 검색 관련도 순서대로
  const recommended = useMemo(() => {
    const byId = new Map(all.map((p) => [p.id, p]));
    return matchedIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  }, [all, matchedIds]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* panel header (fixed) */}
      <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-5">
        <span className="text-[15px] font-bold text-slate-900">
          <span className="text-spark">✦</span> 추천 영양제
        </span>
        {recommended.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{recommended.length}</span>
        )}
        <button
          onClick={() => setCartOpen(true)}
          className="relative ml-auto flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          aria-label="장바구니"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          {cartCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-bold text-white">
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {/* grid (scrolls) */}
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-1">
        {loading ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-7">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-[20px] bg-slate-100" />
            ))}
          </div>
        ) : recommended.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-7">
            {recommended.map((p) => (
              <ProductCard key={p.id} p={p} recommended />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <span className="mb-3 text-3xl">💊</span>
            <p className="text-sm text-slate-500">
              {query ? "조건에 맞는 취급 영양제가 없어요." : "상담하면 맞는 영양제를"}
              {!query && <br />}
              {!query && "추천해드려요."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
