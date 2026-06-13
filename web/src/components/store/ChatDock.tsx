"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/components/store/StoreProvider";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatDock() {
  const { dockOpen, setDockOpen, outbound, consumeOutbound, ask } = useStore();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const msgsRef = useRef<Msg[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const lastAsk = useRef(0);

  useEffect(() => {
    msgsRef.current = messages;
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // consume questions raised from the storefront hero / tag chips / dock input
  useEffect(() => {
    if (outbound && outbound.id !== lastAsk.current) {
      lastAsk.current = outbound.id;
      void stream(outbound.text);
      consumeOutbound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outbound]);

  async function stream(text: string) {
    const next: Msg[] = [...msgsRef.current, { role: "user", content: text }];
    setMessages(next);
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
  }

  function submit() {
    const t = input.trim();
    if (!t || loading) return;
    setInput("");
    ask(t); // routes through store -> filters storefront + triggers stream
  }

  const empty = messages.length === 0;
  const waiting = loading && messages[messages.length - 1]?.role === "user";

  return (
    <>
      {/* mobile floating button */}
      {!dockOpen && (
        <button
          onClick={() => setDockOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-r from-teal-500 to-sky-500 px-5 py-3 text-sm font-semibold text-white shadow-xl shadow-sky-500/40 transition active:scale-95 lg:hidden"
        >
          💬 약사 상담
        </button>
      )}

      {/* mobile backdrop */}
      {dockOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm lg:hidden" onClick={() => setDockOpen(false)} />
      )}

      {/* panel: sticky sidebar on lg, slide-over on mobile */}
      <aside
        className={`z-50 flex w-full max-w-sm flex-col p-3 transition-transform duration-300
          fixed inset-y-0 right-0
          lg:sticky lg:top-4 lg:max-w-none lg:w-[360px] lg:shrink-0 lg:self-start lg:p-0 lg:h-[calc(100vh-2rem)] lg:translate-x-0 lg:inset-y-auto
          ${dockOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"}`}
      >
        <div className="glass flex h-full flex-col overflow-hidden rounded-[24px]">
          {/* header */}
          <div className="flex items-center justify-between border-b border-white/50 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-sky-500 text-lg shadow">
                💊
              </div>
              <div>
                <p className="text-sm font-bold leading-tight text-slate-800">AI 약사 상담</p>
                <p className="text-[11px] text-slate-400">증상을 말하면 진열에서 찾아드려요</p>
              </div>
            </div>
            <button onClick={() => setDockOpen(false)} className="rounded-full px-2 py-1 text-slate-400 hover:bg-white/60 lg:hidden">
              ✕
            </button>
          </div>

          {/* messages */}
          <div className="scroll-soft flex-1 space-y-3 overflow-y-auto px-3.5 py-4">
            {empty && (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <p className="text-sm font-semibold text-slate-700">안녕하세요, 약사입니다 👋</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  건강 고민을 말씀해 주시면 상담하고,
                  <br />
                  맞는 영양제를 왼쪽 진열에서 찾아드려요.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`animate-msg-in flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${
                    m.role === "user" ? "bg-slate-200" : "bg-gradient-to-br from-teal-400 to-sky-500 text-white shadow"
                  }`}
                >
                  {m.role === "user" ? "🙂" : "💊"}
                </div>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed ${
                    m.role === "user"
                      ? "rounded-tr-md bg-gradient-to-br from-teal-500 to-sky-500 text-white shadow-md shadow-sky-500/20"
                      : "rounded-tl-md border border-white/70 bg-white/80 text-slate-700 shadow-sm"
                  }`}
                >
                  {m.content || <TypingDots />}
                </div>
              </div>
            ))}
            {waiting && (
              <div className="animate-msg-in flex gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-sky-500 text-xs text-white shadow">
                  💊
                </div>
                <div className="rounded-2xl rounded-tl-md border border-white/70 bg-white/80 px-3.5 py-2.5 shadow-sm">
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* input */}
          <div className="border-t border-white/50 p-2.5">
            <div className="flex items-center gap-1.5 rounded-full border border-white/60 bg-white/70 py-1 pl-4 pr-1 shadow-sm transition focus-within:border-sky-300 focus-within:bg-white/90">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="증상을 입력하세요…"
                className="flex-1 bg-transparent py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400"
              />
              <button
                onClick={submit}
                disabled={loading || !input.trim()}
                aria-label="보내기"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-sky-500 text-white shadow-md shadow-sky-500/30 transition hover:opacity-90 active:scale-95 disabled:opacity-40"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function TypingDots() {
  return (
    <span className="flex gap-1 py-0.5">
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: "180ms" }} />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: "360ms" }} />
    </span>
  );
}
