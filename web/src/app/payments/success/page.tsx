"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSessionId } from "@/lib/session";

type State =
  | { status: "loading" }
  | { status: "ok"; orderId: string; amount: number }
  | { status: "error"; message: string };

function SuccessContent() {
  const params = useSearchParams();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const paymentKey = params.get("paymentKey");
    const orderId = params.get("orderId");
    const amount = params.get("amount");

    if (!paymentKey || !orderId || !amount) {
      setState({ status: "error", message: "결제 정보가 올바르지 않습니다." });
      return;
    }

    const numAmount = Number(amount);
    if (Number.isNaN(numAmount)) {
      setState({ status: "error", message: "결제 금액이 올바르지 않습니다." });
      return;
    }

    fetch("/api/payments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: getSessionId(),
        paymentKey,
        orderId,
        amount: numAmount,
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          setState({ status: "ok", orderId, amount: numAmount });
        } else {
          const data = await res.json().catch(() => ({}));
          const msg = (data as { error?: string }).error ?? "결제 승인에 실패했습니다.";
          setState({ status: "error", message: msg });
        }
      })
      .catch(() => {
        setState({ status: "error", message: "네트워크 오류가 발생했습니다." });
      });
  }, [params]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">결제 확인 중…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm text-center">
          <span className="mb-4 block text-5xl">❌</span>
          <h1 className="text-base font-bold text-slate-900">결제 오류</h1>
          <p className="mt-2 text-[13px] text-slate-500">{state.message}</p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            홈으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm text-center">
        <span className="mb-4 block text-5xl">✅</span>
        <h1 className="text-base font-bold text-slate-900">결제가 완료되었습니다</h1>
        <div className="mt-4 space-y-1 rounded-xl bg-slate-50 px-4 py-3 text-left text-[13px] text-slate-600">
          <div className="flex justify-between">
            <span className="text-slate-400">주문번호</span>
            <span className="font-medium">{state.orderId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">결제 금액</span>
            <span className="font-medium">{state.amount.toLocaleString()}원</span>
          </div>
        </div>
        <Link
          href="/"
          className="mt-6 inline-block rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          홈으로 돌아가기
        </Link>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <p className="text-sm text-slate-500">결제 확인 중…</p>
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
