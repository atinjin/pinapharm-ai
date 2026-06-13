"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminProductForm } from "@/components/AdminProductForm";

type Product = { id: number; name: string; brand: string | null; price: number; stock: number; conditionTags: string; isActive: boolean };

export default function AdminPage() {
  const [products, setProducts] = useState<Product[]>([]);

  async function load() {
    const res = await fetch("/api/products");
    setProducts(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function remove(id: number) {
    await fetch(`/api/products/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-7 sm:py-10">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-500 text-xl shadow-lg shadow-fuchsia-500/30">
            🗂️
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-extrabold tracking-tight text-slate-800">피나팜 맑은 약국 · 상품 관리</h1>
            <p className="text-xs text-slate-500">취급하는 영양제를 등록·관리합니다</p>
          </div>
        </div>
        <Link
          href="/"
          className="glass rounded-full px-4 py-2 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:bg-white/70"
        >
          상담 화면
        </Link>
      </header>

      <section className="glass mb-6 rounded-3xl p-5 sm:p-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-600">새 영양제 등록</h2>
        <AdminProductForm onCreated={load} />
      </section>

      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-slate-600">등록된 영양제</h2>
        <span className="rounded-full bg-white/60 px-2.5 py-0.5 text-xs font-medium text-slate-500">{products.length}개</span>
      </div>

      <ul className="grid gap-3">
        {products.map((p) => (
          <li key={p.id} className="glass flex items-center justify-between gap-3 rounded-2xl p-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-800">
                {p.name}
                {p.brand && <span className="ml-1.5 text-sm font-normal text-slate-400">· {p.brand}</span>}
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                <span className="font-medium text-slate-700">{p.price.toLocaleString()}원</span>
                <span className="text-slate-300"> · </span>재고 {p.stock}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(JSON.parse(p.conditionTags || "[]") as string[]).map((t) => (
                  <span key={t} className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => remove(p.id)}
              className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-100 active:scale-95"
            >
              삭제
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
