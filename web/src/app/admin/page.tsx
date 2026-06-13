"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminProductForm } from "@/components/AdminProductForm";
import { AdminCsvImport } from "@/components/AdminCsvImport";
import { AdminProductItem, type AdminProduct } from "@/components/AdminProductItem";

export default function AdminPage() {
  const [products, setProducts] = useState<AdminProduct[]>([]);

  async function load() {
    const res = await fetch("/api/products");
    setProducts(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-7 sm:py-10">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="accent flex h-10 w-10 items-center justify-center rounded-xl text-lg text-white">🗂️</span>
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

      <section className="glass mb-5 rounded-3xl p-5 sm:p-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-600">새 영양제 등록</h2>
        <AdminProductForm onCreated={load} />
      </section>

      <section className="glass mb-6 rounded-3xl p-5 sm:p-6">
        <h2 className="mb-1 text-sm font-semibold text-slate-600">CSV 일괄 등록</h2>
        <p className="mb-4 text-xs text-slate-400">엑셀에서 CSV로 저장한 실제 취급 품목을 한 번에 등록합니다.</p>
        <AdminCsvImport onImported={load} />
      </section>

      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-slate-600">등록된 영양제</h2>
        <span className="rounded-full bg-white/60 px-2.5 py-0.5 text-xs font-medium text-slate-500">{products.length}개</span>
      </div>

      <ul className="grid gap-3">
        {products.map((p) => (
          <AdminProductItem key={p.id} p={p} onChanged={load} />
        ))}
      </ul>
    </main>
  );
}
