import Link from "next/link";
import { AdminNav } from "@/components/AdminNav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="accent flex h-10 w-10 items-center justify-center rounded-xl text-lg text-white">🗂️</span>
          <div className="leading-tight">
            <h1 className="text-base font-extrabold tracking-tight text-slate-800">피나팜 맑은 약국 · 관리자</h1>
            <p className="text-xs text-slate-500">상품·에이전트·상담 스킬을 관리합니다</p>
          </div>
        </div>
        <Link
          href="/"
          className="glass rounded-full px-4 py-2 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:bg-white/70"
        >
          상담 화면
        </Link>
      </header>

      <AdminNav />

      {children}
    </main>
  );
}
