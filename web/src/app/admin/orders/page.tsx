"use client";
import { useCallback, useEffect, useState } from "react";
import { AdminOrderItem, type AdminOrderRow } from "@/components/AdminOrderItem";

const STATUS_OPTIONS = [
  { value: "", label: "전체" },
  { value: "pending", label: "결제 대기" },
  { value: "paid", label: "결제 완료" },
  { value: "shipped", label: "배송 중" },
  { value: "delivered", label: "배송 완료" },
  { value: "cancelled", label: "취소됨" },
  { value: "refunded", label: "환불됨" },
];

export default function AdminOrdersPage() {
  const [rows, setRows] = useState<AdminOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (q.trim()) sp.set("q", q.trim());
    sp.set("page", String(page));
    const res = await fetch(`/api/admin/orders?${sp.toString()}`);
    const data = await res.json();
    setRows(data.rows);
    setTotal(data.total);
    setPageSize(data.pageSize);
  }, [status, q, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, q]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      {/* 필터 */}
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="주문번호 / 수령인 검색"
          className="glass rounded-full px-4 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="glass rounded-full px-4 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* 카운트 */}
      <p className="mb-3 text-[12px] text-slate-400">전체 {total}건</p>

      {/* 목록 */}
      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">주문이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((order) => (
            <AdminOrderItem key={order.id} order={order} onChanged={load} />
          ))}
        </div>
      )}

      {/* 페이징 */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="glass rounded-full px-4 py-1.5 text-sm text-slate-600 disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-sm text-slate-500">{page} / {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="glass rounded-full px-4 py-1.5 text-sm text-slate-600 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
