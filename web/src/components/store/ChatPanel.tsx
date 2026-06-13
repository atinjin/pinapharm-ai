"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "@/components/store/StoreProvider";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatPanel() {
  const { outbound, consumeOutbound, ask } = useStore();
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

  const waiting = loading && messages[messages.length - 1]?.role === "user";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* messages (only this scrolls) */}
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="animate-msg-in flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-100 px-4 py-2.5 text-[14px] leading-relaxed text-slate-800">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="animate-msg-in flex gap-3">
                <span className="spark mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs text-white">✦</span>
                <div className="min-w-0 flex-1">
                  {m.content ? (
                    <div className="chat-md">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <TypingDots />
                  )}
                </div>
              </div>
            )
          )}
          {waiting && (
            <div className="animate-msg-in flex gap-3">
              <span className="spark mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs text-white">✦</span>
              <div className="pt-1.5">
                <TypingDots />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* input (fixed at bottom of the chat column) */}
      <div className="shrink-0 px-4 pb-4 pt-2">
        <div className="mx-auto flex max-w-2xl items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1.5 pl-5 pr-1.5 shadow-sm transition focus-within:border-indigo-300 focus-within:shadow">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="맑은 약사에게 이어서 물어보기"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[14px] text-slate-800 outline-none placeholder:text-slate-400"
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
