"use client";
import { useState } from "react";

type SubmitResult =
  | { ok: true }
  | { ok: false; error: string; detail?: { name?: string } };

type Props = {
  onSubmit: (shipping: Record<string, string>) => Promise<SubmitResult>;
  onBack: () => void;
};

export function CheckoutForm({ onSubmit, onBack }: Props) {
  const [recipient, setRecipient] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [zipcode, setZipcode] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = recipient.trim() !== "" && phone.trim() !== "" && address.trim() !== "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const result = await onSubmit({ recipient, phone, address, addressDetail, zipcode, memo });
    setSubmitting(false);
    if (!result.ok) {
      const detail = result.detail;
      if (detail?.name) {
        setError(`${result.error} (재고 부족: ${detail.name})`);
      } else {
        setError(result.error);
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-5">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1 text-[13px] text-slate-400 transition hover:text-slate-700"
      >
        ← 장바구니로 돌아가기
      </button>

      <fieldset className="space-y-3.5">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">
            수령인 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            required
            placeholder="홍길동"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[14px] text-slate-900 placeholder-slate-300 outline-none transition focus:border-slate-400 focus:ring-0"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">
            연락처 <span className="text-red-400">*</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            placeholder="010-0000-0000"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[14px] text-slate-900 placeholder-slate-300 outline-none transition focus:border-slate-400 focus:ring-0"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">
            주소 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            placeholder="서울특별시 강남구 테헤란로 00"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[14px] text-slate-900 placeholder-slate-300 outline-none transition focus:border-slate-400 focus:ring-0"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">상세주소</label>
          <input
            type="text"
            value={addressDetail}
            onChange={(e) => setAddressDetail(e.target.value)}
            placeholder="101동 202호"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[14px] text-slate-900 placeholder-slate-300 outline-none transition focus:border-slate-400 focus:ring-0"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">우편번호</label>
          <input
            type="text"
            value={zipcode}
            onChange={(e) => setZipcode(e.target.value)}
            placeholder="06234"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[14px] text-slate-900 placeholder-slate-300 outline-none transition focus:border-slate-400 focus:ring-0"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-slate-600">메모</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={3}
            placeholder="배송 시 요청사항을 입력해 주세요"
            className="w-full resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-[14px] text-slate-900 placeholder-slate-300 outline-none transition focus:border-slate-400 focus:ring-0"
          />
        </div>
      </fieldset>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-600">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="w-full rounded-full bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "처리 중…" : "주문 확인"}
      </button>
    </form>
  );
}
