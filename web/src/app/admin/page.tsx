"use client";
import { useEffect, useState } from "react";
import { AdminProductForm } from "@/components/AdminProductForm";

type Product = { id: number; name: string; brand: string | null; price: number; stock: number; conditionTags: string; isActive: boolean };

export default function AdminPage() {
  const [products, setProducts] = useState<Product[]>([]);

  async function load() {
    const res = await fetch("/api/products");
    setProducts(await res.json());
  }
  useEffect(() => { load(); }, []);

  async function remove(id: number) {
    await fetch(`/api/products/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>영양제 상품 관리</h1>
      <AdminProductForm onCreated={load} />
      <h2 style={{ marginTop: 24 }}>등록된 영양제 ({products.length})</h2>
      <ul style={{ display: "grid", gap: 8, padding: 0, listStyle: "none" }}>
        {products.map((p) => (
          <li key={p.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <strong>{p.name}</strong> {p.brand && `· ${p.brand}`} — {p.price.toLocaleString()}원 (재고 {p.stock})
            <br />
            <small>태그: {JSON.parse(p.conditionTags || "[]").join(", ")}</small>
            <button onClick={() => remove(p.id)} style={{ marginLeft: 12 }}>삭제</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
