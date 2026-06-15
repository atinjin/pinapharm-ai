"use client";
import { useEffect, useState } from "react";
import { AdminProductForm } from "@/components/AdminProductForm";
import { AdminCsvImport } from "@/components/AdminCsvImport";
import { AdminProductItem, type AdminProduct } from "@/components/AdminProductItem";

export default function AdminProductsPage() {
  const [products, setProducts] = useState<AdminProduct[]>([]);

  async function load() {
    const res = await fetch("/api/products");
    setProducts(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <>
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
    </>
  );
}
