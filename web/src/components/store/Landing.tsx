"use client";
import { useState } from "react";
import { useStore } from "@/components/store/StoreProvider";

const SUGGESTIONS = ["요즘 너무 피곤해요", "눈이 침침해요", "잠을 잘 못 자요", "장이 안 좋아요"];

export function Landing() {
  const { ask } = useStore();
  const [text, setText] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    ask(text);
    setText("");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 pb-16">
      <div className="w-full max-w-xl text-center">
        <span className="spark mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl text-white shadow-sm">
          ✦
        </span>
        <h1 className="text-[28px] font-bold tracking-tight text-slate-900 sm:text-[34px]">
          <span className="text-spark">안녕하세요</span> 👋
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-500 sm:text-base">
          맑은 약사입니다. 건강 고민을 말씀해 주시면
          <br className="hidden sm:block" /> 상담하고 맞는 영양제를 찾아드릴게요.
        </p>

        <form onSubmit={submit} className="mt-7">
          <div className="surface flex items-center gap-2 rounded-full py-2 pl-6 pr-2 transition focus-within:border-indigo-300 focus-within:shadow-md">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="증상을 입력해 보세요 (예: 요즘 너무 피곤해요)"
              className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              aria-label="보내기"
              className="accent flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition hover:opacity-90 active:scale-95 disabled:opacity-40"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </form>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="surface surface-hover rounded-full px-4 py-2 text-sm text-slate-600"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
