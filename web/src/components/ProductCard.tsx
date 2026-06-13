"use client";
import { useState } from "react";
import type { StoreProduct } from "@/components/store/StoreProvider";

// Ritual풍 소프트 파스텔 타일 팔레트 (제품별로 순환)
const TILES = ["#FBF4DA", "#EAE7FB", "#E4F1EC", "#FCEAE3", "#E4EEFB", "#F2EFEA"];

export function ProductCard({ p, recommended }: { p: StoreProduct; recommended?: boolean }) {
  const [bought, setBought] = useState(false);
  const [loading, setLoading] = useState(false);
  const tile = TILES[p.id % TILES.length];

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
    <div className="group flex flex-col">
      {/* pastel product tile */}
      <div
        className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[20px]"
        style={{ backgroundColor: tile }}
      >
        {recommended && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-slate-700 backdrop-blur">
            <span className="text-spark">✦</span> AI 추천
          </span>
        )}
        <span className="text-[64px] transition-transform duration-300 group-hover:scale-105">💊</span>
      </div>

      {/* meta */}
      <div className="flex flex-1 flex-col px-0.5 pt-3.5">
        <h3 className="text-[15px] font-semibold leading-snug text-slate-900">{p.name}</h3>
        {p.brand && <p className="mt-1 text-[13px] text-slate-400">{p.brand}</p>}

        {p.conditionTags && p.conditionTags.length > 0 && (
          <p className="mt-1.5 text-[12px] text-slate-400">{p.conditionTags.slice(0, 3).join(" · ")}</p>
        )}

        <div className="mt-3.5 flex items-center justify-between">
          <span className="text-[15px] font-semibold text-slate-900">{p.price.toLocaleString()}원</span>
          <button
            onClick={buy}
            disabled={bought || loading}
            className={`rounded-full border px-4 py-1.5 text-[13px] font-medium transition active:scale-95 ${
              bought
                ? "border-slate-200 bg-slate-100 text-slate-400"
                : "border-slate-300 text-slate-700 hover:border-slate-900 hover:bg-slate-900 hover:text-white"
            }`}
          >
            {bought ? "담김 ✓" : loading ? "처리중" : "담기"}
          </button>
        </div>
      </div>
    </div>
  );
}
