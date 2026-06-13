import Link from "next/link";
import { StoreProvider } from "@/components/store/StoreProvider";
import { Storefront } from "@/components/store/Storefront";
import { ChatDock } from "@/components/store/ChatDock";

export default function Home() {
  return (
    <StoreProvider>
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:py-7">
        <header className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-sky-500 text-lg shadow">
              💊
            </div>
            <span className="font-bold tracking-tight text-slate-800">약사 영양제 스토어</span>
          </div>
          <Link
            href="/admin"
            className="glass rounded-full px-4 py-2 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:bg-white/70"
          >
            약사 어드민
          </Link>
        </header>

        <div className="flex gap-6">
          <main className="min-w-0 flex-1">
            <Storefront />
            <p className="mt-6 text-center text-[11px] text-slate-400">
              본 상담은 의료 진단이 아니며, 영양제는 의약품을 대체하지 않습니다.
            </p>
          </main>
          <ChatDock />
        </div>
      </div>
    </StoreProvider>
  );
}
