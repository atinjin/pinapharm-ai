import Link from "next/link";
import { StoreProvider } from "@/components/store/StoreProvider";
import { Storefront } from "@/components/store/Storefront";
import { ChatDock } from "@/components/store/ChatDock";

export default function Home() {
  return (
    <StoreProvider>
      {/* MUI Container(lg)풍: 중앙 정렬 + 반응형 거터 */}
      <div className="mx-auto w-full max-w-[1200px] px-4 py-7 sm:px-6 sm:py-9">
        <header className="mb-8 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="accent flex h-9 w-9 items-center justify-center rounded-xl text-base text-white">💊</span>
            <div className="leading-tight">
              <p className="text-[15px] font-bold tracking-tight text-slate-900">피나팜 맑은 약국</p>
              <p className="text-xs text-slate-400">AI 영양제 상담</p>
            </div>
          </Link>
          <Link
            href="/admin"
            className="surface surface-hover shrink-0 rounded-full px-4 py-2 text-sm font-medium text-slate-600"
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
