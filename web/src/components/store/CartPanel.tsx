"use client";
import { useState } from "react";
import { useStore } from "@/components/store/StoreProvider";
import { CheckoutForm } from "@/components/store/CheckoutForm";

type Mode = "cart" | "checkout";

export function CartPanel() {
  const { cart, cartOpen, setCartOpen, updateQty, removeFromCart, checkout } = useStore();
  const [mode, setMode] = useState<Mode>("cart");

  if (!cartOpen) return null;

  const items = cart?.items ?? [];
  const subtotal = cart?.subtotal ?? 0;
  const shipping = subtotal >= 50000 ? 0 : subtotal > 0 ? 3000 : 0;
  const total = subtotal + shipping;

  function handleClose() {
    setCartOpen(false);
    // reset mode after close animation (immediate reset is fine since panel is removed)
    setMode("cart");
  }

  async function handleCheckout(shippingInfo: Record<string, string>) {
    const res = await checkout(shippingInfo);
    if (res.ok && res.order) {
      const o = res.order as { orderNumber: string; total: number };
      const firstItem = items[0];
      const orderName = firstItem
        ? items.length > 1
          ? `${firstItem.name} 외 ${items.length - 1}건`
          : firstItem.name
        : "주문";
      return { ok: true as const, orderNumber: o.orderNumber, total: o.total, orderName };
    }
    const detail = res.detail as { name?: string } | undefined;
    return { ok: false as const, error: res.error ?? "주문 실패", detail };
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* backdrop */}
      <div className="absolute inset-0 bg-slate-900/30" onClick={handleClose} />

      {/* slide-over panel */}
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-xl">
        {/* header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200/70 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-900">
            {mode === "cart" && "장바구니"}
            {mode === "checkout" && "주문하기"}
          </h2>
          <button
            onClick={handleClose}
            aria-label="닫기"
            className="rounded-full px-2 py-1 text-slate-400 transition hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mode === "cart" && (
            <>
              {items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <span className="mb-3 text-4xl">🛒</span>
                  <p className="text-sm text-slate-500">장바구니가 비어 있어요</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 px-5">
                  {items.map((item) => (
                    <li key={item.productId} className="py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[14px] font-semibold text-slate-900">{item.name}</p>
                            {!item.isActive && (
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                판매중지
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[13px] text-slate-400">{item.price.toLocaleString()}원</p>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.productId)}
                          aria-label="삭제"
                          className="shrink-0 rounded-full px-2 py-1 text-[12px] text-slate-400 transition hover:text-red-500"
                        >
                          삭제
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        {/* quantity stepper */}
                        <div className="flex items-center gap-1 rounded-full border border-slate-200 px-1">
                          <button
                            onClick={() => updateQty(item.productId, item.quantity - 1)}
                            aria-label="수량 줄이기"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
                          >
                            −
                          </button>
                          <span className="min-w-[1.5rem] text-center text-[14px] font-semibold text-slate-900">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQty(item.productId, item.quantity + 1)}
                            aria-label="수량 늘리기"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
                          >
                            +
                          </button>
                        </div>

                        <span className="text-[14px] font-semibold text-slate-900">
                          {item.lineTotal.toLocaleString()}원
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {mode === "checkout" && (
            <CheckoutForm onSubmit={handleCheckout} onBack={() => setMode("cart")} />
          )}
        </div>

        {/* footer — only show in cart mode with items */}
        {mode === "cart" && items.length > 0 && (
          <div className="shrink-0 border-t border-slate-200/70 px-5 py-4">
            <div className="space-y-1.5 text-[13px]">
              <div className="flex justify-between text-slate-500">
                <span>소계</span>
                <span>{subtotal.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>배송비</span>
                <span>{shipping === 0 ? "무료" : `${shipping.toLocaleString()}원`}</span>
              </div>
              <div className="flex justify-between pt-1 text-[15px] font-bold text-slate-900">
                <span>합계</span>
                <span>{total.toLocaleString()}원</span>
              </div>
            </div>
            <button
              onClick={() => setMode("checkout")}
              className="mt-4 w-full rounded-full bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 active:scale-95"
            >
              주문하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
