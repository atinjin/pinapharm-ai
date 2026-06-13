"use client";
import { useState } from "react";
import type { StoreProduct } from "@/components/store/StoreProvider";

export function ProductCard({ p, recommended }: { p: StoreProduct; recommended?: boolean }) {
  const [bought, setBought] = useState(false);
  const [loading, setLoading] = useState(false);

  async function buy() {
    setLoading(true);
    await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: p.id, quantity: 1 }),
    });
    setLoading(false);
    setBought(true);
  }

  return (
    <div className={`surface surface-hover group relative flex flex-col overflow-hidden rounded-2xl ${recommended ? "ring-1 ring-indigo-300" : ""}`}>
      {recommended && (
        <span className="spark absolute left-3 top-3 z-10 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white">
          ✦ AI 추천
        </span>
      )}

      {/* image tile */}
      <div className="flex aspect-[4/3] items-center justify-center bg-slate-50 text-5xl transition group-hover:scale-[1.03]">
        💊
      </div>

      {/* body */}
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div>
          <h3 className="text-[15px] font-semibold leading-snug text-slate-900">{p.name}</h3>
          {p.brand && <p className="mt-0.5 text-xs text-slate-400">{p.brand}</p>}
        </div>

        {p.conditionTags && p.conditionTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {p.conditionTags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between pt-1.5">
          <span className="text-[17px] font-bold text-slate-900">
            {p.price.toLocaleString()}
            <span className="ml-0.5 text-xs font-medium text-slate-400">원</span>
          </span>
          <button
            onClick={buy}
            disabled={bought || loading}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition active:scale-95 ${
              bought ? "bg-slate-100 text-slate-400" : "accent text-white hover:opacity-90"
            }`}
          >
            {bought ? "담김 ✓" : loading ? "처리중" : "담기"}
          </button>
        </div>
      </div>
    </div>
  );
}
