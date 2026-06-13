"use client";
import { useState } from "react";

export type AdminProduct = {
  id: number;
  name: string;
  brand: string | null;
  price: number;
  stock: number;
  conditionTags: string;
  isActive: boolean;
  imageUrl: string | null;
};

export function AdminProductItem({ p, onChanged }: { p: AdminProduct; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(p.price));
  const [stock, setStock] = useState(String(p.stock));
  const [active, setActive] = useState(p.isActive);
  const [imageUrl, setImageUrl] = useState(p.imageUrl ?? "");
  const [busy, setBusy] = useState(false);
  const tags = (JSON.parse(p.conditionTags || "[]") as string[]) ?? [];

  async function save() {
    setBusy(true);
    await fetch(`/api/products/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price: Number(price || 0), stock: Number(stock || 0), isActive: active, imageUrl: imageUrl || undefined }),
    });
    setBusy(false);
    setEditing(false);
    onChanged();
  }

  async function remove() {
    await fetch(`/api/products/${p.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <li className={`glass rounded-2xl p-4 transition ${!p.isActive ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          {p.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover" />
          )}
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate font-semibold text-slate-800">{p.name}</p>
            {p.brand && <span className="text-sm font-normal text-slate-400">· {p.brand}</span>}
            {!p.isActive && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">비활성</span>
            )}
            {p.price === 0 && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600">가격미설정</span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            <span className="font-medium text-slate-700">{p.price.toLocaleString()}원</span>
            <span className="text-slate-300"> · </span>재고 {p.stock}
          </p>
          {tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">
                  {t}
                </span>
              ))}
            </div>
          )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-full border border-white/60 bg-white/60 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white/90 active:scale-95"
          >
            {editing ? "닫기" : "수정"}
          </button>
          <button
            onClick={remove}
            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-100 active:scale-95"
          >
            삭제
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-white/50 pt-3">
          <label className="text-xs text-slate-500">
            가격(원)
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1 block w-28 rounded-lg border border-white/60 bg-white/80 px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-sky-300"
            />
          </label>
          <label className="text-xs text-slate-500">
            재고
            <input
              type="number"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className="mt-1 block w-24 rounded-lg border border-white/60 bg-white/80 px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-sky-300"
            />
          </label>
          <label className="flex items-center gap-1.5 pb-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-indigo-500" />
            진열 활성화
          </label>
          <label className="w-full text-xs text-slate-500">
            이미지 URL
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1 block w-full rounded-lg border border-white/60 bg-white/80 px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-sky-300"
            />
          </label>
          <button
            onClick={save}
            disabled={busy}
            className="ml-auto rounded-full accent px-5 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-90 active:scale-95 disabled:opacity-50"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      )}
    </li>
  );
}
