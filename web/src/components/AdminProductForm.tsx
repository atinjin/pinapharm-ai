"use client";
import { useState } from "react";

export function AdminProductForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", price: "", brand: "", description: "", ingredients: "", conditionTags: "", stock: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        price: Number(form.price || 0),
        brand: form.brand || undefined,
        description: form.description || undefined,
        ingredients: form.ingredients || undefined,
        conditionTags: form.conditionTags ? form.conditionTags.split(",").map((s) => s.trim()).filter(Boolean) : [],
        stock: Number(form.stock || 0),
      }),
    });
    setForm({ name: "", price: "", brand: "", description: "", ingredients: "", conditionTags: "", stock: "" });
    onCreated();
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const field =
    "w-full rounded-xl border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input required placeholder="제품명" value={form.name} onChange={set("name")} className={field} />
        <input required type="number" placeholder="가격(원)" value={form.price} onChange={set("price")} className={field} />
        <input placeholder="브랜드" value={form.brand} onChange={set("brand")} className={field} />
        <input type="number" placeholder="재고" value={form.stock} onChange={set("stock")} className={field} />
        <input placeholder="성분" value={form.ingredients} onChange={set("ingredients")} className={`${field} sm:col-span-2`} />
        <input placeholder="적용 증상 태그 (쉼표로 구분)" value={form.conditionTags} onChange={set("conditionTags")} className={`${field} sm:col-span-2`} />
      </div>
      <textarea placeholder="설명" value={form.description} onChange={set("description")} rows={2} className={field} />
      <button
        type="submit"
        className="justify-self-start rounded-full bg-gradient-to-r from-teal-500 to-sky-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-sky-500/30 transition hover:opacity-90 active:scale-95"
      >
        등록하기
      </button>
    </form>
  );
}
