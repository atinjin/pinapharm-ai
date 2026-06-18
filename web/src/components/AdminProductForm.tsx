"use client";
import { useState } from "react";

const EMPTY = {
  name: "",
  price: "",
  brand: "",
  description: "",
  ingredients: "",
  dosageForm: "",
  doseAmount: "",
  doseUnit: "",
  conditionTags: "",
  stock: "",
  imageUrl: "",
};

export function AdminProductForm({ onCreated }: { onCreated: () => void }) {
  const [values, setValues] = useState({ ...EMPTY });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        price: Number(values.price || 0),
        brand: values.brand || undefined,
        description: values.description || undefined,
        ingredients: values.ingredients || undefined,
        form: values.dosageForm || undefined,
        doseAmount: values.doseAmount ? Number(values.doseAmount) : undefined,
        doseUnit: values.doseUnit || undefined,
        conditionTags: values.conditionTags ? values.conditionTags.split(",").map((s) => s.trim()).filter(Boolean) : [],
        stock: Number(values.stock || 0),
        imageUrl: values.imageUrl || undefined,
      }),
    });
    setValues({ ...EMPTY });
    onCreated();
  }

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues({ ...values, [k]: e.target.value });

  const field =
    "w-full rounded-xl border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input required placeholder="제품명" value={values.name} onChange={set("name")} className={field} />
        <input required type="number" placeholder="가격(원)" value={values.price} onChange={set("price")} className={field} />
        <input placeholder="브랜드" value={values.brand} onChange={set("brand")} className={field} />
        <input type="number" placeholder="재고" value={values.stock} onChange={set("stock")} className={field} />
        <input placeholder="제형 (정/캡슐/액상/분말/스틱)" value={values.dosageForm} onChange={set("dosageForm")} className={field} />
        <div className="grid grid-cols-2 gap-3">
          <input type="number" placeholder="용량(숫자)" value={values.doseAmount} onChange={set("doseAmount")} className={field} />
          <input placeholder="단위(mg/g/mL/IU)" value={values.doseUnit} onChange={set("doseUnit")} className={field} />
        </div>
        <input placeholder="성분" value={values.ingredients} onChange={set("ingredients")} className={`${field} sm:col-span-2`} />
        <input placeholder="적용 증상 태그 (쉼표로 구분)" value={values.conditionTags} onChange={set("conditionTags")} className={`${field} sm:col-span-2`} />
        <input placeholder="이미지 URL (https://…)" value={values.imageUrl} onChange={set("imageUrl")} className={`${field} sm:col-span-2`} />
      </div>
      <textarea placeholder="설명" value={values.description} onChange={set("description")} rows={2} className={field} />
      <button
        type="submit"
        className="justify-self-start rounded-full accent px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-90 active:scale-95"
      >
        등록하기
      </button>
    </form>
  );
}
