"use client";
import Link from "next/link";
import { useStore } from "@/components/store/StoreProvider";
import { Landing } from "@/components/store/Landing";
import { ChatPanel } from "@/components/store/ChatPanel";
import { Storefront } from "@/components/store/Storefront";
import { CartPanel } from "@/components/store/CartPanel";

export function Shell() {
  const { started, dockOpen, setDockOpen, matchedIds } = useStore();

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* fixed header */}
      <header className="shrink-0 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="accent flex h-8 w-8 items-center justify-center rounded-lg text-sm text-white">💊</span>
            <div className="leading-tight">
              <p className="text-[14px] font-bold text-slate-900">피나팜 맑은 약국</p>
              <p className="text-[11px] text-slate-400">AI 영양제 상담</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            {started && (
              <button
                onClick={() => setDockOpen(true)}
                className="surface rounded-full px-3.5 py-1.5 text-sm text-slate-600 lg:hidden"
              >
                상품 {matchedIds.length > 0 ? matchedIds.length : ""}
              </button>
            )}
            <Link href="/admin" className="surface rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-600">
              약사 어드민
            </Link>
          </div>
        </div>
      </header>

      {/* body */}
      {!started ? (
        <Landing />
      ) : (
        <div className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1">
          {/* chat (left) */}
          <section className="flex min-w-0 flex-1 flex-col lg:border-r lg:border-slate-200/70">
            <ChatPanel />
          </section>

          {/* products (right, desktop) */}
          <aside className="hidden w-[400px] shrink-0 lg:block xl:w-[440px]">
            <Storefront />
          </aside>

          {/* products (mobile overlay) */}
          {dockOpen && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <div className="absolute inset-0 bg-slate-900/20" onClick={() => setDockOpen(false)} />
              <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-xl">
                <div className="flex shrink-0 items-center justify-between border-b border-slate-200/70 px-5 py-3">
                  <span className="text-sm font-bold text-slate-900">상품</span>
                  <button onClick={() => setDockOpen(false)} className="px-2 text-slate-400 hover:text-slate-700">
                    ✕
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <Storefront />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 장바구니 슬라이드오버 (cartOpen일 때만 렌더) */}
      <CartPanel />
    </div>
  );
}
