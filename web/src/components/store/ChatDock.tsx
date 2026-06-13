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
    ask(t);
  }

  const empty = messages.length === 0;
  const waiting = loading && messages[messages.length - 1]?.role === "user";

  return (
    <>
      {/* mobile floating button */}
      {!dockOpen && (
        <button
          onClick={() => setDockOpen(true)}
          className="accent fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition active:scale-95 lg:hidden"
        >
          <span>✦</span> 맑은 약사
        </button>
      )}

      {/* mobile backdrop */}
      {dockOpen && <div className="fixed inset-0 z-40 bg-slate-900/20 lg:hidden" onClick={() => setDockOpen(false)} />}

      {/* panel */}
      <aside
        className={`z-50 flex w-full max-w-sm flex-col p-3 transition-transform duration-300
          fixed inset-y-0 right-0
          lg:sticky lg:top-4 lg:inset-y-auto lg:max-w-none lg:w-[368px] lg:shrink-0 lg:self-start lg:p-0 lg:h-[calc(100vh-2rem)] lg:translate-x-0
          ${dockOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"}`}
      >
        <div className="surface flex h-full flex-col overflow-hidden rounded-3xl">
          {/* header */}
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="spark flex h-8 w-8 items-center justify-center rounded-full text-sm text-white">✦</span>
              <div>
                <p className="text-sm font-semibold leading-tight text-slate-900">맑은 약사</p>
                <p className="text-[11px] text-slate-400">피나팜 맑은 약국 · AI 상담</p>
              </div>
            </div>
            <button onClick={() => setDockOpen(false)} className="rounded-full px-2 py-1 text-slate-400 hover:bg-slate-100 lg:hidden">
              ✕
            </button>
          </div>

          {/* messages */}
          <div className="scroll-soft flex-1 overflow-y-auto px-4 pb-2">
            {empty ? (
              <div className="flex h-full flex-col items-center justify-center px-2 text-center">
                <span className="spark mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl text-white">✦</span>
                <p className="text-xl font-bold tracking-tight">
                  <span className="text-spark">안녕하세요</span> 👋
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  무엇을 도와드릴까요?
                  <br />
                  건강 고민을 편하게 말씀해 주세요.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-5 py-2">
                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="animate-msg-in flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-100 px-3.5 py-2 text-[14px] leading-relaxed text-slate-800">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="animate-msg-in flex gap-2.5">
                      <span className="spark mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] text-white">✦</span>
                      <div className="min-w-0 flex-1 whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700">
                        {m.content || <TypingDots />}
                      </div>
                    </div>
                  )
                )}
                {waiting && (
                  <div className="animate-msg-in flex gap-2.5">
                    <span className="spark mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] text-white">✦</span>
                    <div className="pt-1">
                      <TypingDots />
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* input */}
          <div className="p-3">
            <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-4 pr-1 transition focus-within:border-indigo-300 focus-within:shadow-sm">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="맑은 약사에게 물어보기"
                className="flex-1 bg-transparent py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400"
              />
              <button
                onClick={submit}
                disabled={loading || !input.trim()}
                aria-label="보내기"
                className="accent flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition hover:opacity-90 active:scale-95 disabled:opacity-30"
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
    <span className="flex gap-1 py-1">
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: "180ms" }} />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: "360ms" }} />
    </span>
  );
}
