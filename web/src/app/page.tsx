import Link from "next/link";
import { ChatPanel } from "@/components/ChatPanel";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-7 sm:py-10">
      <header className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-sky-500 text-xl shadow-lg shadow-sky-500/30">
            💊
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-800">약사 상담</h1>
            <p className="text-xs text-slate-500">AI 약사가 맞춤 영양제를 찾아드려요</p>
          </div>
        </div>
        <Link
          href="/admin"
          className="glass rounded-full px-4 py-2 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:bg-white/70"
        >
          약사 어드민
        </Link>
      </header>

      <ChatPanel />

      <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-400">
        본 상담은 의료 진단이 아니며, 영양제는 의약품을 대체하지 않습니다.
      </p>
    </main>
  );
}
