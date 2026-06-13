"use client";
import { useState } from "react";

export type RecProduct = { id: number; name: string; brand?: string | null; price: number; description?: string | null };

export function ProductCard({ p }: { p: RecProduct }) {
  const [bought, setBought] = useState(false);
  async function buy() {
    await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: p.id, quantity: 1 }),
    });
    setBought(true);
  }
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minWidth: 200 }}>
      <strong>{p.name}</strong> {p.brand && `· ${p.brand}`}
      <div>{p.price.toLocaleString()}원</div>
      {p.description && <small>{p.description}</small>}
      <div>
        <button onClick={buy} disabled={bought}>{bought ? "주문됨" : "구매"}</button>
      </div>
    </div>
  );
}
