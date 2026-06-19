"use client";
import { useEffect, useState } from "react";
import { diffLines } from "diff";
import { Modal } from "@/components/Modal";

type Rev = { id: number; snapshot: Record<string, unknown>; summary: string | null; createdAt: string };

// 버전 이력 + 현재↔선택 버전 diff + 롤백.
export function RevisionHistory({
  open,
  entityType,
  entityId,
  diffKey,
  currentText,
  onClose,
  onRolledBack,
}: {
  open: boolean;
  entityType: string;
  entityId: string;
  diffKey: string; // 본문 비교 필드 (skill/doc="body", agentSetting="value")
  currentText: string;
  onClose: () => void;
  onRolledBack: () => void;
}) {
  const [revs, setRevs] = useState<Rev[]>([]);
  const [selected, setSelected] = useState<Rev | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setError("");
    fetch(`/api/admin/revisions?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`)
      .then((r) => r.json())
      .then((d) => setRevs(Array.isArray(d) ? d : []));
  }, [open, entityType, entityId]);

  async function rollback() {
    if (!selected) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/revisions/${selected.id}/rollback`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(typeof d.error === "string" ? d.error : "롤백에 실패했습니다.");
      return;
    }
    onRolledBack();
    onClose();
  }

  const MAX_DIFF = 50000;
  const selText = selected ? String(selected.snapshot[diffKey] ?? "") : "";
  const tooLarge = !!selected && (currentText.length > MAX_DIFF || selText.length > MAX_DIFF);
  const parts = selected && !tooLarge ? diffLines(currentText, selText) : [];

  return (
    <Modal open={open} title="버전 이력" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-[210px_1fr]">
        <ul className="grid max-h-72 gap-1 overflow-y-auto">
          {revs.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setSelected(r)}
                className={`w-full rounded-lg px-2 py-1.5 text-left text-xs transition ${
                  selected?.id === r.id ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-white/70"
                }`}
              >
                <div>{new Date(r.createdAt).toLocaleString("ko-KR")}</div>
                {r.summary && <div className="text-slate-400">{r.summary}</div>}
              </button>
            </li>
          ))}
          {revs.length === 0 && <li className="px-2 text-xs text-slate-400">버전 이력이 없습니다.</li>}
        </ul>
        <div>
          {!selected ? (
            <p className="text-xs text-slate-400">왼쪽에서 버전을 선택하면 현재 내용과의 차이가 표시됩니다.</p>
          ) : (
            <>
              <p className="mb-1 text-xs text-slate-400">
                현재 ↔ 선택 버전 — <span className="text-rose-600">빨강=롤백 시 사라짐</span> ·{" "}
                <span className="text-teal-700">초록=롤백 시 복원됨</span>
              </p>
              {tooLarge ? (
                <p className="text-xs text-amber-600">내용이 너무 커서 diff 미리보기를 생략합니다(롤백은 가능).</p>
              ) : (
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 text-xs leading-relaxed">
                  {parts.map((p, i) => (
                    <span
                      key={i}
                      className={p.added ? "bg-teal-100 text-teal-800" : p.removed ? "bg-rose-100 text-rose-700 line-through" : "text-slate-500"}
                    >
                      {p.value}
                    </span>
                  ))}
                </pre>
              )}
              {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
              <button
                onClick={rollback}
                disabled={busy}
                className="mt-3 rounded-full bg-rose-500 px-4 py-1.5 text-sm font-semibold text-white shadow-md shadow-rose-500/30 transition hover:bg-rose-600 active:scale-95 disabled:opacity-50"
              >
                {busy ? "롤백 중…" : "이 버전으로 롤백"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
