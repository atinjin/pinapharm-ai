"use client";
import { useState } from "react";
import { ProductCard, RecProduct } from "@/components/ProductCard";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [recs, setRecs] = useState<RecProduct[]>([]);
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!input.trim()) return;
    const next: Msg[] = [...messages, { role: "user", content: input }];
    setMessages(next);
    setInput("");
    setLoading(true);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next }),
    });

    let acc = "";
    setMessages([...next, { role: "assistant", content: "" }]);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value);
      setMessages([...next, { role: "assistant", content: acc }]);
    }
    setLoading(false);

    const r = await fetch(`/api/agent-tools/search-products?condition=${encodeURIComponent(input)}`);
    if (r.ok) setRecs(await r.json());
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, minHeight: 240 }}>
        {messages.map((m, i) => (
          <p key={i}><strong>{m.role === "user" ? "나" : "약사"}:</strong> {m.content}</p>
        ))}
        {loading && <p><em>약사가 답변 중…</em></p>}
      </div>
      {recs.length > 0 && (
        <div>
          <h3>추천 영양제</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {recs.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ flex: 1 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="건강 고민을 입력하세요 (예: 요즘 너무 피곤해요)"
        />
        <button onClick={send} disabled={loading}>보내기</button>
      </div>
    </div>
  );
}
