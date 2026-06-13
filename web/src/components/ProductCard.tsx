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
    <div
      className={`glass group relative flex flex-col gap-3 rounded-3xl p-4 transition duration-200 hover:-translate-y-1 hover:shadow-xl ${
        recommended ? "ring-2 ring-sky-300/70" : ""
      }`}
    >
      {recommended && (
        <span className="absolute right-3 top-3 z-10 rounded-full bg-gradient-to-r from-teal-500 to-sky-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-md shadow-sky-500/30">
          ✦ AI 추천
        </span>
      )}
      <div className="flex h-32 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-100 to-sky-100 text-5xl transition group-hover:scale-105">
        💊
      </div>
      <div>
        <p className="font-semibold leading-tight text-slate-800">{p.name}</p>
        {p.brand && <p className="text-xs text-slate-400">{p.brand}</p>}
      </div>
      {p.conditionTags && p.conditionTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.conditionTags.slice(0, 3).map((t) => (
            <span key={t} className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] text-teal-700">
              {t}
            </span>
          ))}
        </div>
      )}
      {p.description && <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">{p.description}</p>}
      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="text-lg font-bold text-slate-900">
          {p.price.toLocaleString()}
          <span className="text-xs font-normal text-slate-400">원</span>
        </span>
        <button
          onClick={buy}
          disabled={bought || loading}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition active:scale-95 ${
            bought
              ? "bg-slate-200 text-slate-500"
              : "bg-gradient-to-r from-teal-500 to-sky-500 text-white shadow-md shadow-sky-500/30 hover:opacity-90"
          }`}
        >
          {bought ? "담김 ✓" : loading ? "처리중" : "담기"}
        </button>
      </div>
    </div>
  );
}
