"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "상품 관리" },
  { href: "/admin/agent", label: "에이전트 설정" },
  { href: "/admin/skills", label: "상담 스킬" },
  { href: "/admin/knowledge", label: "지식 베이스" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-2">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              active
                ? "accent rounded-full px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/30"
                : "glass rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:-translate-y-0.5 hover:bg-white/70"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
