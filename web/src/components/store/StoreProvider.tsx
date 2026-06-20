"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getSessionId } from "@/lib/session";

type CartItemView = { productId: number; name: string; price: number; quantity: number; lineTotal: number; isActive: boolean; stock: number };
type CartView = { items: CartItemView[]; subtotal: number };

export type StoreProduct = {
  id: number;
  name: string;
  brand?: string | null;
  price: number;
  description?: string | null;
  ingredients?: string | null;
  conditionTags?: string[];
  stock?: number;
  imageUrl?: string | null;
};

type StoreState = {
  all: StoreProduct[];
  loading: boolean;
  query: string | null;
  matchedIds: number[];
  /** products in display order: matched (AI 추천) first, then the rest */
  display: StoreProduct[];
  allTags: string[];
  /** 대화가 한 번이라도 시작됐는지 (true면 분할 레이아웃) */
  started: boolean;
  /** 모바일에서 결과(상품) 패널 열림 여부 */
  dockOpen: boolean;
  setDockOpen: (v: boolean) => void;
  /** ask the AI + filter the storefront like a search */
  ask: (q: string) => void;
  /** 에이전트가 실제 추천(조회)한 제품 ID로 우측 패널을 갱신 */
  setRecommended: (ids: number[]) => void;
  /** 에이전트가 방출한 상담 계획 단계 목록 */
  plan: string[] | null;
  setPlan: (steps: string[]) => void;
  clearSearch: () => void;
  /** internal chat bridge */
  outbound: { id: number; text: string } | null;
  consumeOutbound: () => void;
  /** 장바구니 */
  cart: CartView | null;
  cartCount: number;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
  addToCart: (productId: number) => Promise<void>;
  updateQty: (productId: number, quantity: number) => Promise<void>;
  removeFromCart: (productId: number) => Promise<void>;
  refreshCart: () => Promise<void>;
  checkout: (shipping: Record<string, string>) => Promise<{ ok: boolean; order?: unknown; error?: string; detail?: unknown }>;
};

const Ctx = createContext<StoreState | null>(null);

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within StoreProvider");
  return v;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [all, setAll] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<number[]>([]);
  const [dockOpen, setDockOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [outbound, setOutbound] = useState<{ id: number; text: string } | null>(null);
  const [plan, setPlanState] = useState<string[] | null>(null);
  const [cart, setCart] = useState<CartView | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const askSeq = useRef(0);

  // load full catalog once (no params -> all active products)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/agent-tools/search-products");
        if (r.ok) setAll(await r.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const r = await fetch(`/api/agent-tools/search-products?condition=${encodeURIComponent(q)}`);
    if (r.ok) {
      const matched: StoreProduct[] = await r.json();
      setMatchedIds(matched.map((m) => m.id));
    }
  }, []);

  const ask = useCallback(
    (q: string) => {
      const text = q.trim();
      if (!text) return;
      setStarted(true);
      setQuery(text);
      runSearch(text);
      setOutbound({ id: ++askSeq.current, text });
    },
    [runSearch]
  );

  const consumeOutbound = useCallback(() => setOutbound(null), []);

  const setRecommended = useCallback((ids: number[]) => setMatchedIds(ids), []);

  const setPlan = useCallback((steps: string[]) => setPlanState(steps), []);

  const clearSearch = useCallback(() => {
    setQuery(null);
    setMatchedIds([]);
  }, []);

  const refreshCart = useCallback(async () => {
    const r = await fetch(`/api/cart?session_id=${encodeURIComponent(getSessionId())}`);
    if (r.ok) setCart(await r.json());
  }, []);
  const addToCart = useCallback(async (productId: number) => {
    const r = await fetch("/api/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: getSessionId(), productId, quantity: 1 }) });
    if (r.ok) setCart(await r.json());
  }, []);
  const updateQty = useCallback(async (productId: number, quantity: number) => {
    const r = await fetch("/api/cart", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: getSessionId(), productId, quantity }) });
    if (r.ok) setCart(await r.json());
  }, []);
  const removeFromCart = useCallback(async (productId: number) => {
    const r = await fetch("/api/cart", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: getSessionId(), productId }) });
    if (r.ok) setCart(await r.json());
  }, []);
  const checkout = useCallback(async (shipping: Record<string, string>) => {
    const r = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: getSessionId(), shipping }) });
    const data = await r.json();
    if (r.ok) { await refreshCart(); return { ok: true, order: data }; }
    return { ok: false, error: data?.error?.toString?.() ?? data?.code ?? "주문 실패", detail: data?.detail };
  }, [refreshCart]);

  useEffect(() => { void refreshCart(); }, [refreshCart]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const p of all) (p.conditionTags ?? []).forEach((t) => s.add(t));
    return Array.from(s);
  }, [all]);

  const display = useMemo(() => {
    if (!query || matchedIds.length === 0) return all;
    const matchedSet = new Set(matchedIds);
    const matched = all.filter((p) => matchedSet.has(p.id));
    const rest = all.filter((p) => !matchedSet.has(p.id));
    return [...matched, ...rest];
  }, [all, query, matchedIds]);

  const cartCount = cart?.items.reduce((s, it) => s + it.quantity, 0) ?? 0;

  const value: StoreState = {
    all,
    loading,
    query,
    matchedIds,
    display,
    allTags,
    started,
    dockOpen,
    setDockOpen,
    ask,
    setRecommended,
    clearSearch,
    outbound,
    consumeOutbound,
    plan,
    setPlan,
    cart,
    cartCount,
    cartOpen,
    setCartOpen,
    addToCart,
    updateQty,
    removeFromCart,
    refreshCart,
    checkout,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
