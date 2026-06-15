"use client";
import { useEffect, useMemo, useState } from "react";
import { AdminProductForm } from "@/components/AdminProductForm";
import { AdminCsvImport } from "@/components/AdminCsvImport";
import { AdminProductItem, type AdminProduct } from "@/components/AdminProductItem";

type SortKey = "recent" | "name" | "priceAsc" | "priceDesc" | "stockAsc";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "최신순" },
  { key: "name", label: "이름순" },
  { key: "priceAsc", label: "가격 낮은순" },
  { key: "priceDesc", label: "가격 높은순" },
  { key: "stockAsc", label: "재고 적은순" },
];

function matches(p: AdminProduct, q: string): boolean {
  const tags = (JSON.parse(p.conditionTags || "[]") as string[]).join(" ");
  return [p.name, p.brand ?? "", tags].join(" ").toLowerCase().includes(q);
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  async function load() {
    const res = await fetch("/api/products");
    setProducts(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? products.filter((p) => matches(p, q)) : products;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name, "ko");
        case "priceAsc":
          return a.price - b.price;
        case "priceDesc":
          return b.price - a.price;
        case "stockAsc":
          return a.stock - b.stock;
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
    return sorted;
  }, [products, query, sort]);

  const field =
    "w-full rounded-xl border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

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
        <span className="rounded-full bg-white/60 px-2.5 py-0.5 text-xs font-medium text-slate-500">
          {visible.length}
          {query.trim() ? ` / ${products.length}` : ""}개
        </span>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          placeholder="제품명·브랜드·증상 태그 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={field}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className={`${field} sm:w-44`}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="px-1 py-6 text-sm text-slate-400">
          {query.trim() ? "검색 결과가 없습니다." : "등록된 영양제가 없습니다."}
        </p>
      ) : (
        <ul className="grid gap-3">
          {visible.map((p) => (
            <AdminProductItem key={p.id} p={p} onChanged={load} />
          ))}
        </ul>
      )}
    </>
  );
}
