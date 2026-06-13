"use client";
import { useState } from "react";
import { parseProductCsv, SAMPLE_CSV, type CsvProductRow } from "@/lib/csv";

export function AdminCsvImport({ onImported }: { onImported: () => void }) {
  const [rows, setRows] = useState<CsvProductRow[]>([]);
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const text = await file.text();
    const parsed = parseProductCsv(text);
    setRows(parsed.rows);
    setErrors(parsed.errors);
  }

  async function submit() {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: rows }),
      });
      const data = await res.json();
      setResult({ created: data.created ?? 0, failed: (data.failed ?? []).length });
      setRows([]);
      setErrors([]);
      setFileName("");
      onImported();
    } finally {
      setBusy(false);
    }
  }

  const sampleHref = "data:text/csv;charset=utf-8," + encodeURIComponent(SAMPLE_CSV);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-full border border-white/60 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/90">
          CSV 파일 선택
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
        </label>
        <a href={sampleHref} download="영양제_샘플.csv" className="text-sm text-sky-600 underline-offset-2 hover:underline">
          샘플 CSV 다운로드
        </a>
        {fileName && <span className="text-xs text-slate-400">{fileName}</span>}
      </div>

      <p className="text-xs leading-relaxed text-slate-400">
        헤더: <code className="rounded bg-slate-100 px-1 py-0.5">name, brand, price, stock, ingredients, conditionTags, description</code>
        <br />
        conditionTags는 셀 안에서 <code className="rounded bg-slate-100 px-1 py-0.5">;</code> 로 구분 (예: 장건강;소화)
      </p>

      {(rows.length > 0 || errors.length > 0) && (
        <div className="rounded-2xl border border-white/60 bg-white/50 p-3 text-sm">
          <p className="font-medium text-slate-700">
            등록 가능 <span className="text-teal-600">{rows.length}</span>건
            {errors.length > 0 && <span className="ml-2 text-rose-500">오류 {errors.length}건</span>}
          </p>
          {errors.length > 0 && (
            <ul className="mt-1.5 max-h-24 list-disc overflow-y-auto pl-5 text-xs text-rose-500">
              {errors.map((er, i) => (
                <li key={i}>
                  {er.line}행: {er.message}
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <button
              onClick={submit}
              disabled={busy}
              className="mt-3 rounded-full bg-gradient-to-r from-teal-500 to-sky-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-sky-500/30 transition hover:opacity-90 active:scale-95 disabled:opacity-50"
            >
              {busy ? "등록 중…" : `${rows.length}건 일괄 등록`}
            </button>
          )}
        </div>
      )}

      {result && (
        <p className="text-sm text-slate-600">
          ✅ <span className="font-semibold text-teal-600">{result.created}건</span> 등록 완료
          {result.failed > 0 && <span className="ml-2 text-rose-500">실패 {result.failed}건</span>}
        </p>
      )}
    </div>
  );
}
