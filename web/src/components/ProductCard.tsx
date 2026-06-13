"use client";
import { useState } from "react";

export type RecProduct = { id: number; name: string; brand?: string | null; price: number; description?: string | null };

export function ProductCard({ p }: { p: RecProduct }) {
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
    <div className="glass flex w-60 shrink-0 flex-col gap-2 rounded-3xl p-4 transition duration-200 hover:-translate-y-1 hover:shadow-xl">
      <div className="flex h-24 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-100 to-sky-100 text-3xl">
        💊
      </div>
      <div>
        <p className="text-sm font-semibold leading-tight text-slate-800">{p.name}</p>
        {p.brand && <p className="text-xs text-slate-400">{p.brand}</p>}
      </div>
      {p.description && <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">{p.description}</p>}
      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="text-base font-bold text-slate-900">
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
          {bought ? "주문됨 ✓" : loading ? "처리중" : "구매"}
        </button>
      </div>
    </div>
  );
}
