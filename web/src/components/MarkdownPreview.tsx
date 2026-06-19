"use client";
import ReactMarkdown from "react-markdown";

export function MarkdownPreview({ text }: { text: string }) {
  return (
    <div className="chat-md max-h-60 overflow-auto rounded-xl border border-white/60 bg-white/50 p-3 text-sm text-slate-700">
      {text.trim() ? <ReactMarkdown>{text}</ReactMarkdown> : <span className="text-slate-400">미리볼 내용이 없습니다.</span>}
    </div>
  );
}
