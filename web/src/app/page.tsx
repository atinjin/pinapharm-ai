import Link from "next/link";
import { StoreProvider } from "@/components/store/StoreProvider";
import { Storefront } from "@/components/store/Storefront";
import { ChatDock } from "@/components/store/ChatDock";

export default function Home() {
  return (
    <StoreProvider>
      <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
        <header className="mb-7 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-sky-500 text-xl shadow-lg shadow-sky-500/30">
              💊
            </div>
            <div className="leading-tight">
              <p className="text-base font-extrabold tracking-tight text-slate-800">피나팜 맑은 약국</p>
              <p className="text-xs text-slate-500">AI 영양제 상담</p>
            </div>
          </Link>
          <Link
            href="/admin"
            className="glass shrink-0 rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:-translate-y-0.5 hover:bg-white/70"
          >
            약사 어드민
          </Link>
        </header>

        <div className="flex gap-8">
          <main className="min-w-0 flex-1">
            <Storefront />
            <p className="mt-8 text-center text-[11px] leading-relaxed text-slate-400">
              본 상담은 의료 진단이 아니며, 영양제는 의약품을 대체하지 않습니다.
            </p>
          </main>
          <ChatDock />
        </div>
      </div>
    </StoreProvider>
  );
}
