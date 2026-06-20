"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function FailContent() {
  const params = useSearchParams();
  const code = params.get("code") ?? "UNKNOWN";
  const message = params.get("message") ?? "알 수 없는 오류가 발생했습니다.";
  const orderId = params.get("orderId");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm text-center">
        <span className="mb-4 block text-5xl">⚠️</span>
        <h1 className="text-base font-bold text-slate-900">결제가 실패했습니다</h1>
        <div className="mt-4 space-y-1 rounded-xl bg-slate-50 px-4 py-3 text-left text-[13px] text-slate-600">
          <div className="flex justify-between gap-4">
            <span className="shrink-0 text-slate-400">오류 코드</span>
            <span className="font-medium">{code}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="shrink-0 text-slate-400">메시지</span>
            <span className="text-right font-medium">{message}</span>
          </div>
          {orderId && (
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-slate-400">주문번호</span>
              <span className="font-medium">{orderId}</span>
            </div>
          )}
        </div>
        <p className="mt-4 text-[13px] text-slate-500">
          결제가 취소되었거나 오류가 발생했습니다. 장바구니로 돌아가서 다시 시도해 주세요.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/"
            className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            홈으로 돌아가기
          </Link>
          <Link
            href="/"
            className="rounded-full border border-slate-200 px-6 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-400"
          >
            장바구니로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PaymentFailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <p className="text-sm text-slate-500">페이지 로딩 중…</p>
        </div>
      }
    >
      <FailContent />
    </Suspense>
  );
}
