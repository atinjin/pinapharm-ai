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

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 480 }}>
      <input required placeholder="제품명" value={form.name} onChange={set("name")} />
      <input required type="number" placeholder="가격(원)" value={form.price} onChange={set("price")} />
      <input placeholder="브랜드" value={form.brand} onChange={set("brand")} />
      <input placeholder="성분" value={form.ingredients} onChange={set("ingredients")} />
      <input placeholder="적용 증상 태그(쉼표로 구분)" value={form.conditionTags} onChange={set("conditionTags")} />
      <input type="number" placeholder="재고" value={form.stock} onChange={set("stock")} />
      <textarea placeholder="설명" value={form.description} onChange={set("description")} />
      <button type="submit">등록</button>
    </form>
  );
}
