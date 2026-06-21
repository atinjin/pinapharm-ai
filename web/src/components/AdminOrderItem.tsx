"use client";
import { useState } from "react";

// 서버 lib를 클라이언트에 임포트하면 Prisma가 번들에 포함되므로, 상수를 인라인 복사
const TRACKING_URL_TEMPLATES: Record<string, string> = {
  CJ: "https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo={no}",
  LOTTE: "https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo={no}",
  HANJIN: "https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillSch.do?mCode=MN038&schLang=KOR&wblnumText2={no}",
  POST: "https://service.epost.go.kr/trace.RetrieveEmsRigiTraceList.comm?POST_CODE={no}",
  LOGEN: "https://www.ilogen.com/web/personal/trace/{no}",
};
const CARRIER_LABELS: Record<string, string> = {
  CJ: "CJ대한통운", LOTTE: "롯데택배", HANJIN: "한진택배", POST: "우체국택배", LOGEN: "로젠택배",
};
function getTrackingUrl(carrier: string, no: string) {
  const t = TRACKING_URL_TEMPLATES[carrier];
  return t ? t.replace("{no}", encodeURIComponent(no)) : null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "결제 대기", paid: "결제 완료", shipped: "배송 중",
  delivered: "배송 완료", cancelled: "취소됨", refunded: "환불됨",
};
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  paid: "bg-blue-100 text-blue-700",
  shipped: "bg-amber-100 text-amber-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
  refunded: "bg-purple-100 text-purple-700",
};

export type AdminOrderRow = {
  id: number;
  orderNumber: string;
  status: string;
  recipient: string;
  phone: string;
  address: string;
  addressDetail?: string | null;
  zipcode?: string | null;
  memo?: string | null;
  subtotal: number;
  shippingFee: number;
  total: number;
  paidAt?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  items: { id: number; productName: string; unitPrice: number; quantity: number; lineTotal: number }[];
};

export function AdminOrderItem({
  order,
  onChanged,
}: {
  order: AdminOrderRow;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [shipForm, setShipForm] = useState(false);
  const [carrier, setCarrier] = useState("CJ");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRemoteZip = order.zipcode?.startsWith("63");
  const tUrl =
    order.carrier && order.trackingNumber ? getTrackingUrl(order.carrier, order.trackingNumber) : null;

  async function handleShip() {
    if (!trackingNumber.trim()) { setError("송장번호를 입력하세요."); return; }
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/orders/${order.id}/ship`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrier, trackingNumber: trackingNumber.trim() }),
    });
    setBusy(false);
    if (res.ok) { setShipForm(false); setTrackingNumber(""); onChanged(); }
    else { const d = await res.json(); setError(d.error ?? "오류가 발생했습니다."); }
  }

  async function handleDeliver() {
    if (!confirm("배송완료로 처리하시겠습니까?")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/orders/${order.id}/deliver`, { method: "POST" });
    setBusy(false);
    if (res.ok) onChanged();
  }

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-5 py-4 shadow-sm">
      {/* 요약 행 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-slate-800">{order.orderNumber}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[order.status] ?? "bg-slate-100 text-slate-600"}`}
            >
              {STATUS_LABELS[order.status] ?? order.status}
            </span>
            {isRemoteZip && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
                도서산간
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[12px] text-slate-500">
            <span>{order.recipient} {order.phone}</span>
            <span>합계 {order.total.toLocaleString()}원</span>
            {order.paidAt && <span>결제 {new Date(order.paidAt).toLocaleDateString("ko-KR")}</span>}
            {order.carrier && order.trackingNumber && (
              <span>{CARRIER_LABELS[order.carrier] ?? order.carrier} {order.trackingNumber}</span>
            )}
          </div>
        </button>

        {/* 액션 */}
        <div className="flex shrink-0 flex-wrap gap-2">
          {order.status === "paid" && !shipForm && (
            <button
              onClick={() => setShipForm(true)}
              className="rounded-full bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-blue-700"
            >
              송장 입력
            </button>
          )}
          {order.status === "shipped" && (
            <>
              {tUrl && (
                <a
                  href={tUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  배송 추적
                </a>
              )}
              <button
                onClick={handleDeliver}
                disabled={busy}
                className="rounded-full bg-green-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                배송완료
              </button>
            </>
          )}
          {order.status === "delivered" && tUrl && (
            <a
              href={tUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-slate-300 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              배송 추적
            </a>
          )}
        </div>
      </div>

      {/* 송장 입력 폼 */}
      {shipForm && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500">택배사</label>
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] outline-none focus:border-indigo-400"
            >
              {Object.entries(CARRIER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="mb-1 block text-[11px] font-medium text-slate-500">송장번호</label>
            <input
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="1234567890"
              className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] outline-none focus:border-indigo-400"
            />
          </div>
          <button
            onClick={handleShip}
            disabled={busy}
            className="rounded-full bg-blue-600 px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? "처리 중…" : "발송 처리"}
          </button>
          <button
            onClick={() => { setShipForm(false); setError(null); }}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-[12px] text-slate-500"
          >
            취소
          </button>
          {error && <p className="w-full text-[12px] text-red-500">{error}</p>}
        </div>
      )}

      {/* 펼치기: 상품 + 배송지 */}
      {open && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-1 text-[11px] font-semibold text-slate-500">주문 상품</p>
          <ul className="mb-3 space-y-1">
            {order.items.map((it) => (
              <li key={it.id} className="flex justify-between text-[12px] text-slate-700">
                <span>{it.productName} × {it.quantity}</span>
                <span>{it.lineTotal.toLocaleString()}원</span>
              </li>
            ))}
          </ul>
          <p className="mb-1 text-[11px] font-semibold text-slate-500">배송지</p>
          <p className="text-[12px] text-slate-700">
            {order.address}{order.addressDetail ? ` ${order.addressDetail}` : ""}
            {order.zipcode ? ` (${order.zipcode})` : ""}
          </p>
          {order.memo && <p className="mt-1 text-[12px] text-slate-500">메모: {order.memo}</p>}
        </div>
      )}
    </div>
  );
}
