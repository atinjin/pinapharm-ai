"use client";
import { useEffect, useRef, useState } from "react";
import { ProductCard, RecProduct } from "@/components/ProductCard";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = ["요즘 너무 피곤해요", "눈이 침침해요", "잠을 잘 못 자요", "장이 안 좋아요"];

export function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [recs, setRecs] = useState<RecProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, recs]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setRecs([]);
    setLoading(true);

    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      setMessages([...next, { role: "assistant", content: "" }]);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value);
        setMessages([...next, { role: "assistant", content: acc }]);
      }
    } catch {
      setMessages([...next, { role: "assistant", content: "상담 연결에 문제가 발생했어요. 잠시 후 다시 시도해주세요." }]);
    } finally {
      setLoading(false);
    }

    const r = await fetch(`/api/agent-tools/search-products?condition=${encodeURIComponent(content)}`);
    if (r.ok) setRecs(await r.json());
  }

  const empty = messages.length === 0;
  const waiting = loading && messages[messages.length - 1]?.role === "user";

  return (
    <div className="glass flex h-[68vh] min-h-[460px] flex-col overflow-hidden rounded-[28px]">
      {/* messages */}
      <div className="scroll-soft flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-teal-400 to-sky-500 text-3xl shadow-lg shadow-sky-500/30">
              💊
            </div>
            <h2 className="text-lg font-bold text-slate-800">무엇을 도와드릴까요?</h2>
            <p className="mt-1 text-sm text-slate-500">건강 고민을 편하게 말씀해주세요.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-white/60 bg-white/50 px-4 py-2 text-sm text-slate-700 transition hover:-translate-y-0.5 hover:bg-white/80 hover:shadow"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`animate-msg-in flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${
                  m.role === "user" ? "bg-slate-200" : "bg-gradient-to-br from-teal-400 to-sky-500 text-white shadow"
                }`}
              >
                {m.role === "user" ? "🙂" : "💊"}
              </div>
              <div
                className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                  m.role === "user"
                    ? "rounded-tr-md bg-gradient-to-br from-teal-500 to-sky-500 text-white shadow-md shadow-sky-500/20"
                    : "rounded-tl-md border border-white/70 bg-white/80 text-slate-700 shadow-sm"
                }`}
              >
                {m.content || <TypingDots />}
              </div>
            </div>
          ))
        )}
        {waiting && (
          <div className="animate-msg-in flex gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-sky-500 text-sm text-white shadow">
              💊
            </div>
            <div className="rounded-2xl rounded-tl-md border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* recommendations */}
      {recs.length > 0 && (
        <div className="border-t border-white/50 px-4 py-3 sm:px-6">
          <p className="mb-2 text-xs font-semibold text-slate-500">추천 영양제</p>
          <div className="scroll-soft flex gap-3 overflow-x-auto pb-1">
            {recs.map((p) => (
              <ProductCard key={p.id} p={p} />
            ))}
          </div>
        </div>
      )}

      {/* input */}
      <div className="border-t border-white/50 p-3 sm:p-4">
        <div className="flex items-center gap-2 rounded-full border border-white/60 bg-white/70 py-1.5 pl-4 pr-1.5 shadow-sm transition focus-within:border-sky-300 focus-within:bg-white/90">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="건강 고민을 입력하세요…"
            className="flex-1 bg-transparent py-2 text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            aria-label="보내기"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-sky-500 text-white shadow-md shadow-sky-500/30 transition hover:opacity-90 active:scale-95 disabled:opacity-40"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex gap-1 py-1">
      <span className="typing-dot h-2 w-2 rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
      <span className="typing-dot h-2 w-2 rounded-full bg-slate-400" style={{ animationDelay: "180ms" }} />
      <span className="typing-dot h-2 w-2 rounded-full bg-slate-400" style={{ animationDelay: "360ms" }} />
    </span>
  );
}
