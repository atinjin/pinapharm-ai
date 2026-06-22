"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type CategoryRow = {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  displayOrder: number;
  docCount: number;
};

const PRESET_ICONS = [
  "💊", "💉", "🩺", "🌿", "🔬", "🧪", "🧬", "📋",
  "📖", "🌱", "🧠", "❤️", "⚠️", "⭐", "🏥", "💡",
];

function EmojiInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="이모지 선택 또는 입력"
        maxLength={2}
        className={field}
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="flex flex-wrap gap-1">
            {PRESET_ICONS.map((em) => (
              <button
                key={em}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onChange(em);
                  setOpen(false);
                }}
                className={`rounded-lg px-1.5 py-0.5 text-[18px] leading-none transition hover:bg-slate-100 ${
                  value === em ? "bg-slate-100 ring-1 ring-slate-300" : ""
                }`}
              >
                {em}
              </button>
            ))}
          </div>
          {value && !PRESET_ICONS.includes(value) && (
            <p className="mt-1.5 text-[11px] text-slate-400">
              직접 입력: <span className="text-[15px]">{value}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const CATEGORY_COLORS = [
  { label: "없음", value: "" },
  { label: "에메랄드", value: "bg-emerald-100 text-emerald-700" },
  { label: "파랑", value: "bg-blue-100 text-blue-700" },
  { label: "보라", value: "bg-violet-100 text-violet-700" },
  { label: "주황", value: "bg-orange-100 text-orange-700" },
  { label: "분홍", value: "bg-pink-100 text-pink-700" },
  { label: "회색", value: "bg-slate-100 text-slate-600" },
];

const field =
  "w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

export function AdminCategoryManager({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string; description: string; icon: string; color: string; displayOrder: string;
  }>({ name: "", description: "", icon: "", color: "", displayOrder: "0" });
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [newForm, setNewForm] = useState({
    name: "", description: "", icon: "", color: "", displayOrder: "0",
  });
  const [newError, setNewError] = useState("");
  const [editError, setEditError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/knowledge-categories");
    const data = await res.json();
    setRows(data.rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEdit(row: CategoryRow) {
    setEditingId(row.id);
    setEditError("");
    setEditForm({
      name: row.name,
      description: row.description ?? "",
      icon: row.icon ?? "",
      color: row.color ?? "",
      displayOrder: String(row.displayOrder),
    });
    setDeletingId(null);
  }

  async function saveEdit(id: number) {
    setBusy(true);
    const res = await fetch(`/api/admin/knowledge-categories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name.trim() || undefined,
        description: editForm.description || null,
        icon: editForm.icon || null,
        color: editForm.color || null,
        displayOrder: Number(editForm.displayOrder),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json();
      setEditError(d.error ?? "저장 실패");
      return;
    }
    setEditingId(null);
    await load();
    onChanged?.();
  }

  async function confirmDelete(id: number) {
    setBusy(true);
    const res = await fetch(`/api/admin/knowledge-categories/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json();
      setDeleteError(d.error ?? "삭제 실패");
      return;
    }
    setDeletingId(null);
    await load();
    onChanged?.();
  }

  async function addCategory() {
    if (!newForm.name.trim()) { setNewError("이름을 입력하세요."); return; }
    setNewError("");
    setBusy(true);
    const res = await fetch("/api/admin/knowledge-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newForm.name.trim(),
        description: newForm.description || undefined,
        icon: newForm.icon || undefined,
        color: newForm.color || undefined,
        displayOrder: Number(newForm.displayOrder),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setNewForm({ name: "", description: "", icon: "", color: "", displayOrder: "0" });
      await load();
      onChanged?.();
    } else {
      const d = await res.json();
      setNewError(d.error ?? "생성 실패");
    }
  }

  if (loading) return <p className="py-6 text-center text-sm text-slate-400">불러오는 중…</p>;

  return (
    <div className="grid gap-4">
      {/* 카테고리 목록 */}
      <ul className="grid gap-2">
        {rows.map((row) => {
          const isProtected = row.name === "미분류";
          const isEditing = editingId === row.id;
          const isDeleting = deletingId === row.id;

          return (
            <li key={row.id} className="rounded-xl border border-slate-200/70 bg-white px-4 py-3">
              {isEditing ? (
                <div className="grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="이름"
                      disabled={isProtected}
                      className={field}
                    />
                    <EmojiInput
                      value={editForm.icon}
                      onChange={(v) => setEditForm((f) => ({ ...f, icon: v }))}
                    />
                  </div>
                  <input
                    value={editForm.description}
                    onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="설명 (선택)"
                    className={field}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1">
                      <span className="px-1 text-[11px] font-medium text-slate-400">배지 색상</span>
                      <select
                        value={editForm.color}
                        onChange={(e) => setEditForm((f) => ({ ...f, color: e.target.value }))}
                        className={field}
                      >
                        {CATEGORY_COLORS.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span className="px-1 text-[11px] font-medium text-slate-400">정렬 순서 (낮을수록 앞)</span>
                      <input
                        type="number"
                        value={editForm.displayOrder}
                        onChange={(e) => setEditForm((f) => ({ ...f, displayOrder: e.target.value }))}
                        className={field}
                      />
                    </label>
                  </div>
                  {editForm.color && (
                    <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${editForm.color}`}>
                      {editForm.icon} {editForm.name || "미리보기"}
                    </span>
                  )}
                  {editError && <p className="text-[12px] text-rose-500">{editError}</p>}
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => saveEdit(row.id)}
                      disabled={busy}
                      className="rounded-full bg-indigo-600 px-4 py-1 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      저장
                    </button>
                  </div>
                </div>
              ) : isDeleting ? (
                <div>
                  {row.docCount > 0 ? (
                    <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                      <span className="font-semibold">&apos;{row.name}&apos;</span> 카테고리의 문서{" "}
                      <span className="font-semibold">{row.docCount}개</span>가 &apos;미분류&apos;로 이동됩니다.
                      계속하시겠습니까?
                    </p>
                  ) : (
                    <p className="mb-3 text-[13px] text-slate-600">
                      &apos;{row.name}&apos; 카테고리를 삭제하시겠습니까?
                    </p>
                  )}
                  {deleteError && <p className="mb-2 text-[12px] text-rose-500">{deleteError}</p>}
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setDeletingId(null)}
                      className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => confirmDelete(row.id)}
                      disabled={busy}
                      className="rounded-full bg-rose-500 px-4 py-1 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    {row.color ? (
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${row.color}`}>
                        {row.icon} {row.name}
                      </span>
                    ) : (
                      <span className="text-sm font-semibold text-slate-700">
                        {row.icon ? `${row.icon} ` : ""}{row.name}
                      </span>
                    )}
                    {row.description && (
                      <span className="truncate text-[12px] text-slate-400">{row.description}</span>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    {row.docCount}개
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => startEdit(row)}
                      className="rounded-full border border-slate-200 px-2.5 py-1 text-[12px] text-slate-500 hover:bg-slate-50"
                    >
                      수정
                    </button>
                    <button
                      onClick={async () => { if (!isProtected) { setDeleteError(""); await load(); setDeletingId(row.id); } }}
                      disabled={isProtected}
                      title={isProtected ? "시스템 카테고리는 삭제할 수 없습니다" : undefined}
                      className="rounded-full border border-slate-200 px-2.5 py-1 text-[12px] text-rose-500 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* 새 카테고리 추가 */}
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4">
        <p className="mb-2 text-[12px] font-semibold text-slate-500">새 카테고리 추가</p>
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={newForm.name}
              onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="이름 *"
              className={field}
            />
            <EmojiInput
              value={newForm.icon}
              onChange={(v) => setNewForm((f) => ({ ...f, icon: v }))}
            />
          </div>
          <input
            value={newForm.description}
            onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="설명 (선택)"
            className={field}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="px-1 text-[11px] font-medium text-slate-400">배지 색상</span>
              <select
                value={newForm.color}
                onChange={(e) => setNewForm((f) => ({ ...f, color: e.target.value }))}
                className={field}
              >
                {CATEGORY_COLORS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="px-1 text-[11px] font-medium text-slate-400">정렬 순서 (낮을수록 앞)</span>
              <input
                type="number"
                value={newForm.displayOrder}
                onChange={(e) => setNewForm((f) => ({ ...f, displayOrder: e.target.value }))}
                className={field}
              />
            </label>
          </div>
          {newForm.color && newForm.name && (
            <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${newForm.color}`}>
              {newForm.icon} {newForm.name}
            </span>
          )}
          {newError && <p className="text-[12px] text-rose-500">{newError}</p>}
          <button
            onClick={addCategory}
            disabled={busy}
            className="rounded-full bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? "추가 중…" : "카테고리 추가"}
          </button>
        </div>
      </div>
    </div>
  );
}
