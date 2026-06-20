# 커머스 E1 — 토스페이먼츠 결제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 토스페이먼츠(테스트 키)로 결제를 붙여 주문을 `pending → paid`로 완성하고, paid 취소 시 PG 환불(`refunded`)·재고 복원, 웹훅 서명검증으로 정합을 보장한다.

**Architecture:** `lib/payments.ts`가 Toss REST(confirm/cancel/get)와 웹훅 HMAC 검증을 감싼다. `lib/orders.ts`에 `confirmPayment`(금액대조·멱등·전이)와 환불 인지 `cancelOrder`를 둔다. `/api/payments/confirm`·`/api/payments/webhook` + 클라 success/fail 페이지 + CheckoutForm의 Toss `requestPayment` 배선.

**Tech Stack:** Next.js 16, Prisma/SQLite, Toss Payments REST v1 + `@tosspayments/tosspayments-sdk`(클라), node:crypto(HMAC), vitest.

## Global Constraints

- **서버측 금액 신뢰**: confirm은 클라 `amount`가 DB `order.total`과 **일치할 때만** Toss 승인. 불일치 시 `AMOUNT_MISMATCH`(Toss 미호출).
- **멱등**: 이미 `paid`면 재confirm 금지(이중결제 방지). 웹훅 재조정도 멱등.
- **카드정보 비저장**: `paymentKey`·`method`만 저장.
- 금액 정수 KRW. 외부 PG 호출은 `prisma.$transaction` **밖**에서, DB 갱신은 트랜잭션 안.
- 상태: `pending→paid`(confirm), `paid→refunded`(환불), `pending→cancelled`(미결제 취소). 취소·환불은 재고 복원.
- 내부/PG 에러 메시지 비노출. web 테스트 `cd web && npm test`(vitest). 커밋 말미 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. `--no-verify` 금지.
- **Toss 문서 검증(필수)**: confirm/cancel/get 엔드포인트·요청형식·웹훅 서명 헤더·SDK v2 사용법은 토스페이먼츠 현행 문서/설치된 패키지 타입으로 확인해 맞춘다.

## Phase 1 — 데이터 + 에러코드

### Task 1: Order 결제 컬럼 + 마이그레이션 + 에러코드

**Files:** Modify `web/prisma/schema.prisma`, `web/src/lib/commerceErrors.ts`; Test `web/tests/commerceErrors.test.ts`

- [ ] **Step 1: 스키마** — `Order` 모델에 추가:
```prisma
  paymentKey    String?
  paymentMethod String?
  paidAt        DateTime?
  pgProvider    String?
```
- [ ] **Step 2: 마이그레이션** — `cd web && npx prisma migrate dev --name order_payment_fields` (nullable 추가뿐, 기존 행 호환, 리셋 프롬프트 뜨면 STOP).
- [ ] **Step 3: 에러코드 실패 테스트** — `web/tests/commerceErrors.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { commerceStatus } from "@/lib/commerceErrors";

describe("commerceStatus", () => {
  it("maps payment codes", () => {
    expect(commerceStatus("AMOUNT_MISMATCH")).toBe(400);
    expect(commerceStatus("PAYMENT_FAILED")).toBe(502);
    expect(commerceStatus("NOT_FOUND")).toBe(404);
    expect(commerceStatus("OUT_OF_STOCK")).toBe(409);
  });
});
```
- [ ] **Step 4: 에러코드 구현** — `commerceErrors.ts`:
```ts
export type CommerceCode = "NOT_FOUND" | "INACTIVE" | "EMPTY_CART" | "OUT_OF_STOCK" | "INVALID_TRANSITION" | "AMOUNT_MISMATCH" | "PAYMENT_FAILED";
```
  그리고 `commerceStatus`에 분기 추가:
```ts
    case "PAYMENT_FAILED": return 502;
    case "AMOUNT_MISMATCH": return 400;
```
  (기존 NOT_FOUND/OUT_OF_STOCK/INVALID_TRANSITION/default 유지.)
- [ ] **Step 5: 통과** — `cd web && npm test -- commerceErrors` → green. `npx tsc --noEmit` clean.
- [ ] **Step 6: 커밋** — `feat(commerce): Order 결제 컬럼 + 마이그레이션 + 결제 에러코드`

## Phase 2 — Toss 클라이언트

### Task 2: `lib/payments.ts`

**Files:** Create `web/src/lib/payments.ts`; Test `web/tests/payments.test.ts`

**Interfaces (produces):** `tossConfirm({paymentKey,orderId,amount})`, `tossCancel(paymentKey,cancelReason)`, `tossGetPayment(paymentKey)`, `verifyWebhookSignature(rawBody, signature)`, type `TossPayment`.

- [ ] **Step 1: 실패 테스트** — `web/tests/payments.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import { tossConfirm, tossCancel, verifyWebhookSignature } from "@/lib/payments";

afterEach(() => vi.unstubAllGlobals());

function okFetch(body: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => body }));
}

describe("payments", () => {
  it("tossConfirm: confirm URL + Basic auth + 본문", async () => {
    process.env.TOSS_SECRET_KEY = "test_sk_X";
    const f = okFetch({ paymentKey: "pk", orderId: "ORD-1", status: "DONE", totalAmount: 39000, method: "카드" });
    vi.stubGlobal("fetch", f);
    const r = await tossConfirm({ paymentKey: "pk", orderId: "ORD-1", amount: 39000 });
    expect(r.status).toBe("DONE");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/payments/confirm");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(JSON.parse(init.body as string)).toEqual({ paymentKey: "pk", orderId: "ORD-1", amount: 39000 });
  });

  it("tossConfirm: 비2xx면 PAYMENT_FAILED", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ code: "REJECT_CARD_COMPANY", message: "거절" }) })));
    await expect(tossConfirm({ paymentKey: "x", orderId: "y", amount: 1 })).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
  });

  it("tossCancel: cancel URL + cancelReason", async () => {
    process.env.TOSS_SECRET_KEY = "test_sk_X";
    const f = okFetch({ paymentKey: "pk", orderId: "ORD-1", status: "CANCELED", totalAmount: 39000 });
    vi.stubGlobal("fetch", f);
    await tossCancel("pk", "고객 취소");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/payments/pk/cancel");
    expect(JSON.parse(init.body as string)).toEqual({ cancelReason: "고객 취소" });
  });

  it("verifyWebhookSignature: HMAC-SHA256 검증", () => {
    process.env.TOSS_WEBHOOK_SECRET = "whsec";
    const body = '{"eventType":"PAYMENT_STATUS_CHANGED"}';
    const sig = crypto.createHmac("sha256", "whsec").update(body, "utf8").digest("base64");
    expect(verifyWebhookSignature(body, sig)).toBe(true);
    expect(verifyWebhookSignature(body, "bad")).toBe(false);
    expect(verifyWebhookSignature(body, null)).toBe(false);
  });
});
```
- [ ] **Step 2: 실패 확인** — `cd web && npm test -- payments` → 모듈 없음.
- [ ] **Step 3: 구현** — `web/src/lib/payments.ts`:
```ts
import crypto from "node:crypto";

const TOSS_API = "https://api.tosspayments.com/v1";

export type TossPayment = {
  paymentKey: string;
  orderId: string;
  status: string; // DONE | CANCELED | ...
  method?: string;
  totalAmount: number;
  approvedAt?: string;
};

function authHeader(): string {
  const key = process.env.TOSS_SECRET_KEY ?? "";
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

async function tossFetch(path: string, init: RequestInit): Promise<TossPayment> {
  const res = await fetch(`${TOSS_API}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { message?: string })?.message ?? "toss error") as Error & { code?: string; tossCode?: string };
    err.code = "PAYMENT_FAILED";
    err.tossCode = (data as { code?: string })?.code;
    throw err;
  }
  return data as TossPayment;
}

export function tossConfirm(params: { paymentKey: string; orderId: string; amount: number }): Promise<TossPayment> {
  return tossFetch("/payments/confirm", { method: "POST", body: JSON.stringify(params) });
}

export function tossCancel(paymentKey: string, cancelReason: string): Promise<TossPayment> {
  return tossFetch(`/payments/${encodeURIComponent(paymentKey)}/cancel`, { method: "POST", body: JSON.stringify({ cancelReason }) });
}

export function tossGetPayment(paymentKey: string): Promise<TossPayment> {
  return tossFetch(`/payments/${encodeURIComponent(paymentKey)}`, { method: "GET" });
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.TOSS_WEBHOOK_SECRET ?? "";
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```
- [ ] **Step 4: 통과** — `cd web && npm test -- payments` → green.
- [ ] **Step 5: 커밋** — `feat(commerce): 토스페이먼츠 클라이언트(confirm·cancel·get·웹훅 서명검증)`

## Phase 3 — 주문 도메인

### Task 3: `confirmPayment` + 환불 인지 `cancelOrder` + 웹훅 재조정

**Files:** Modify `web/src/lib/orders.ts`; Test `web/tests/payment-orders.test.ts`

**Interfaces (consumes** `tossConfirm`/`tossCancel`/`tossGetPayment`**; produces):** `confirmPayment(orderNumber, paymentKey, amount, customerId)`, `cancelOrder(id, customerId)`(환불 인지), `reconcileFromToss(orderNumber, payment)`(웹훅용).

- [ ] **Step 1: 실패 테스트** — `web/tests/payment-orders.test.ts`(payments 모듈 목):
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/payments", () => ({
  tossConfirm: vi.fn(async ({ paymentKey }: { paymentKey: string }) => ({ paymentKey, orderId: "x", status: "DONE", totalAmount: 0, method: "카드" })),
  tossCancel: vi.fn(async (pk: string) => ({ paymentKey: pk, orderId: "x", status: "CANCELED", totalAmount: 0 })),
  tossGetPayment: vi.fn(async (pk: string) => ({ paymentKey: pk, orderId: "x", status: "CANCELED", totalAmount: 0 })),
}));

import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { addItem } from "@/lib/cart";
import { placeOrder, confirmPayment, cancelOrder } from "@/lib/orders";
import { tossConfirm, tossCancel } from "@/lib/payments";

let productId: number;
const SHIP = { recipient: "홍길동", phone: "010", address: "서울" };

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  const ph = await prisma.pharmacist.create({ data: { name: "약사" } });
  productId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "비타민C", price: 18000, stock: 10, isActive: true } })).id;
});

async function pendingOrder(sid: string) {
  const c = await resolveCustomer(sid);
  await addItem(c, productId, 2); // 36000 + 3000 = 39000
  const order = await placeOrder(c, SHIP);
  return { c, order };
}

describe("confirmPayment", () => {
  it("정상: pending→paid, 결제정보 저장", async () => {
    const { c, order } = await pendingOrder(`p-${Date.now()}-1`);
    const paid = await confirmPayment(order.orderNumber, "pk_1", order.total, c);
    expect(paid.status).toBe("paid");
    expect(paid.paymentKey).toBe("pk_1");
    expect(paid.pgProvider).toBe("toss");
    expect(tossConfirm).toHaveBeenCalledTimes(1);
  });

  it("금액 불일치: AMOUNT_MISMATCH, Toss 미호출", async () => {
    const { c, order } = await pendingOrder(`p-${Date.now()}-2`);
    await expect(confirmPayment(order.orderNumber, "pk", order.total - 1, c)).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
    expect(tossConfirm).not.toHaveBeenCalled();
  });

  it("멱등: 이미 paid면 재confirm 안 함", async () => {
    const { c, order } = await pendingOrder(`p-${Date.now()}-3`);
    await confirmPayment(order.orderNumber, "pk", order.total, c);
    vi.clearAllMocks();
    const again = await confirmPayment(order.orderNumber, "pk", order.total, c);
    expect(again.status).toBe("paid");
    expect(tossConfirm).not.toHaveBeenCalled();
  });

  it("남의 주문: NOT_FOUND", async () => {
    const { order } = await pendingOrder(`p-${Date.now()}-4`);
    const other = await resolveCustomer(`other-${Date.now()}`);
    await expect(confirmPayment(order.orderNumber, "pk", order.total, other)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("cancelOrder 환불 인지", () => {
  it("paid 취소: tossCancel 호출 → refunded + 재고 복원", async () => {
    const { c, order } = await pendingOrder(`p-${Date.now()}-5`);
    await confirmPayment(order.orderNumber, "pk_5", order.total, c);
    const refunded = await cancelOrder(order.id, c);
    expect(refunded.status).toBe("refunded");
    expect(tossCancel).toHaveBeenCalledTimes(1);
    expect((await prisma.product.findUnique({ where: { id: productId } }))!.stock).toBe(10);
  });

  it("pending 취소: PG 미호출 → cancelled + 재고 복원", async () => {
    const { c, order } = await pendingOrder(`p-${Date.now()}-6`);
    const cancelled = await cancelOrder(order.id, c);
    expect(cancelled.status).toBe("cancelled");
    expect(tossCancel).not.toHaveBeenCalled();
    expect((await prisma.product.findUnique({ where: { id: productId } }))!.stock).toBe(10);
  });
});
```
- [ ] **Step 2: 실패 확인** — `cd web && npm test -- payment-orders` → `confirmPayment` 없음.
- [ ] **Step 3: 구현** — `orders.ts` 상단 import 추가 `import { tossConfirm, tossCancel } from "@/lib/payments";` 그리고 `confirmPayment` 추가 + `cancelOrder` 교체:
```ts
export async function confirmPayment(orderNumber: string, paymentKey: string, amount: number, customerId: number) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include: { items: true } });
  if (!order || order.customerId !== customerId) throw new CommerceError("NOT_FOUND", "주문을 찾을 수 없습니다.");
  if (order.status === "paid") return order; // 멱등
  if (order.status !== "pending") throw new CommerceError("INVALID_TRANSITION", `결제할 수 없는 상태입니다: ${order.status}`);
  if (amount !== order.total) throw new CommerceError("AMOUNT_MISMATCH", "결제 금액이 주문 금액과 일치하지 않습니다.", { expected: order.total, got: amount });
  const payment = await tossConfirm({ paymentKey, orderId: orderNumber, amount });
  return prisma.order.update({
    where: { id: order.id },
    data: { status: "paid", paymentKey: payment.paymentKey, paymentMethod: payment.method ?? null, paidAt: new Date(), pgProvider: "toss" },
    include: { items: true },
  });
}

export async function cancelOrder(id: number, customerId: number) {
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order || order.customerId !== customerId) throw new CommerceError("NOT_FOUND", "주문을 찾을 수 없습니다.");
  if (!["pending", "paid"].includes(order.status)) {
    throw new CommerceError("INVALID_TRANSITION", `취소할 수 없는 상태입니다: ${order.status}`);
  }
  if (order.status === "paid" && order.paymentKey) {
    await tossCancel(order.paymentKey, "고객 취소"); // 외부, 트랜잭션 밖
  }
  const nextStatus = order.status === "paid" ? "refunded" : "cancelled";
  return prisma.$transaction(async (tx) => {
    for (const it of order.items) {
      await tx.product.update({ where: { id: it.productId }, data: { stock: { increment: it.quantity } } });
    }
    return tx.order.update({ where: { id }, data: { status: nextStatus }, include: { items: true } });
  });
}

// 웹훅 재조정(멱등): Toss가 source of truth
export async function reconcileFromToss(orderNumber: string, payment: { status: string; paymentKey: string; method?: string }) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include: { items: true } });
  if (!order) return;
  if (payment.status === "DONE" && order.status === "pending") {
    await prisma.order.update({ where: { id: order.id }, data: { status: "paid", paymentKey: payment.paymentKey, paymentMethod: payment.method ?? null, paidAt: new Date(), pgProvider: "toss" } });
  } else if (payment.status === "CANCELED" && order.status === "paid") {
    await prisma.$transaction(async (tx) => {
      for (const it of order.items) await tx.product.update({ where: { id: it.productId }, data: { stock: { increment: it.quantity } } });
      await tx.order.update({ where: { id: order.id }, data: { status: "refunded" } });
    });
  }
}
```
  **주의:** 기존 `cancelOrder`(트랜잭션 단일) 정의를 위 버전으로 교체. 기존 `orders.test.ts`의 pending-cancel·double-cancel·non-owner 테스트는 동작 동일(green 유지)해야 함 — 교체 후 `npm test -- orders.test` 확인.
- [ ] **Step 4: 통과** — `cd web && npm test -- payment-orders` green, `npm test -- orders.test` green(회귀 없음).
- [ ] **Step 5: 커밋** — `feat(commerce): confirmPayment + 환불 인지 cancelOrder + 웹훅 재조정`

## Phase 4 — API

### Task 4: `/api/payments/confirm`

**Files:** Create `web/src/app/api/payments/confirm/route.ts`; Test `web/tests/payments-confirm-api.test.ts`

- [ ] **Step 1: 실패 테스트** — `web/tests/payments-confirm-api.test.ts`(payments 모듈 목으로 Toss 차단):
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/payments", () => ({
  tossConfirm: vi.fn(async ({ paymentKey, amount }: { paymentKey: string; amount: number }) => ({ paymentKey, orderId: "x", status: "DONE", totalAmount: amount, method: "카드" })),
  tossCancel: vi.fn(), tossGetPayment: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { addItem } from "@/lib/cart";
import { placeOrder } from "@/lib/orders";
import { POST as confirm } from "@/app/api/payments/confirm/route";

let productId: number;
const SID = `pc-${Date.now()}`;

beforeEach(async () => {
  await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany(); await prisma.cart.deleteMany();
  const ph = await prisma.pharmacist.create({ data: { name: "약사" } });
  productId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "비타민C", price: 18000, stock: 10, isActive: true } })).id;
});

const post = (b: unknown) => new NextRequest("http://localhost/api/payments/confirm", { method: "POST", body: JSON.stringify(b), headers: { "Content-Type": "application/json" } });

describe("/api/payments/confirm", () => {
  it("정상 결제 승인 → paid", async () => {
    const c = await resolveCustomer(SID);
    await addItem(c, productId, 2);
    const order = await placeOrder(c, { recipient: "홍", phone: "010", address: "서울" });
    const res = await confirm(post({ session_id: SID, paymentKey: "pk", orderId: order.orderNumber, amount: order.total }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("paid");
  });

  it("금액 불일치 400", async () => {
    const c = await resolveCustomer(`${SID}-2`);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, { recipient: "홍", phone: "010", address: "서울" });
    const res = await confirm(post({ session_id: `${SID}-2`, paymentKey: "pk", orderId: order.orderNumber, amount: order.total - 1 }));
    expect(res.status).toBe(400);
  });
});
```
- [ ] **Step 2: 실패 확인** — 라우트 없음.
- [ ] **Step 3: 구현** — `web/src/app/api/payments/confirm/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveCustomer } from "@/lib/customers";
import { confirmPayment } from "@/lib/orders";
import { CommerceError, commerceStatus } from "@/lib/commerceErrors";

const schema = z.object({ session_id: z.string().min(1), paymentKey: z.string().min(1), orderId: z.string().min(1), amount: z.number().int() });

export async function POST(req: NextRequest) {
  const p = schema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  try {
    const customerId = await resolveCustomer(p.data.session_id);
    const order = await confirmPayment(p.data.orderId, p.data.paymentKey, p.data.amount, customerId);
    return NextResponse.json(order);
  } catch (e) {
    if (e instanceof CommerceError) return NextResponse.json({ error: e.message, code: e.code, detail: e.detail }, { status: commerceStatus(e.code) });
    if ((e as { code?: string })?.code === "PAYMENT_FAILED") return NextResponse.json({ error: "결제 승인에 실패했습니다.", code: "PAYMENT_FAILED" }, { status: 502 });
    return NextResponse.json({ error: "결제 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
```
- [ ] **Step 4: 통과** — `cd web && npm test -- payments-confirm-api` green.
- [ ] **Step 5: 커밋** — `feat(commerce): /api/payments/confirm`

### Task 5: `/api/payments/webhook`

**Files:** Create `web/src/app/api/payments/webhook/route.ts`; Test `web/tests/payments-webhook-api.test.ts`

- [ ] **Step 1: 실패 테스트** — `web/tests/payments-webhook-api.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

vi.mock("@/lib/payments", async (orig) => {
  const actual = await orig<typeof import("@/lib/payments")>();
  return { ...actual, tossGetPayment: vi.fn(async (pk: string) => ({ paymentKey: pk, orderId: "x", status: "DONE", totalAmount: 0, method: "카드" })) };
});

import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { addItem } from "@/lib/cart";
import { placeOrder } from "@/lib/orders";
import { POST as webhook } from "@/app/api/payments/webhook/route";

let productId: number;
beforeEach(async () => {
  process.env.TOSS_WEBHOOK_SECRET = "whsec";
  await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany(); await prisma.cart.deleteMany();
  const ph = await prisma.pharmacist.create({ data: { name: "약사" } });
  productId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "비타민C", price: 18000, stock: 10, isActive: true } })).id;
});

function signed(body: string) {
  const sig = crypto.createHmac("sha256", "whsec").update(body, "utf8").digest("base64");
  return new NextRequest("http://localhost/api/payments/webhook", { method: "POST", body, headers: { "Content-Type": "application/json", "tosspayments-webhook-signature": sig } });
}

describe("/api/payments/webhook", () => {
  it("유효 서명 + DONE → 주문 paid 재조정", async () => {
    const c = await resolveCustomer(`wh-${Date.now()}`);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, { recipient: "홍", phone: "010", address: "서울" });
    const body = JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: "pk", orderId: order.orderNumber, status: "DONE" } });
    const res = await webhook(signed(body));
    expect(res.status).toBe(200);
    expect((await prisma.order.findUnique({ where: { id: order.id } }))!.status).toBe("paid");
  });

  it("무효 서명 401", async () => {
    const body = JSON.stringify({ data: { paymentKey: "pk" } });
    const res = await webhook(new NextRequest("http://localhost/api/payments/webhook", { method: "POST", body, headers: { "tosspayments-webhook-signature": "bad" } }));
    expect(res.status).toBe(401);
  });
});
```
- [ ] **Step 2: 실패 확인** — 라우트 없음.
- [ ] **Step 3: 구현** — `web/src/app/api/payments/webhook/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature, tossGetPayment } from "@/lib/payments";
import { reconcileFromToss } from "@/lib/orders";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  // 헤더명은 Toss 문서로 확인(여기서는 tosspayments-webhook-signature 가정)
  const sig = req.headers.get("tosspayments-webhook-signature");
  if (!verifyWebhookSignature(raw, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let event: { data?: { paymentKey?: string; orderId?: string }; paymentKey?: string; orderId?: string };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad payload" }, { status: 400 }); }
  const paymentKey = event.data?.paymentKey ?? event.paymentKey;
  const orderId = event.data?.orderId ?? event.orderId;
  if (paymentKey && orderId) {
    try {
      const payment = await tossGetPayment(paymentKey); // Toss가 source of truth
      await reconcileFromToss(orderId, payment);
    } catch {
      // 재조정 실패는 로깅만, 200 ack(중복 재전송 유도)
    }
  }
  return NextResponse.json({ ok: true });
}
```
- [ ] **Step 4: 통과** — `cd web && npm test -- payments-webhook-api` green. 전체 `npm test` green, `npx tsc --noEmit` clean.
- [ ] **Step 5: 커밋** — `feat(commerce): /api/payments/webhook (서명검증 + 재조정)`

## Phase 5 — 클라이언트

### Task 6: Toss SDK 설치 + env + CheckoutForm 결제 배선 + success/fail 페이지

**Files:** Modify `web/package.json`(SDK), `web/.env.example`, `web/src/components/store/CheckoutForm.tsx`; Create `web/src/app/payments/success/page.tsx`, `web/src/app/payments/fail/page.tsx`

- [ ] **Step 1: SDK 설치** — `cd web && npm install @tosspayments/tosspayments-sdk`. **설치된 패키지의 타입/README로 v2 `requestPayment` 사용법을 확인**해 아래 코드를 맞춘다.
- [ ] **Step 2: env** — `web/.env.example`에 추가:
```
# 결제 — 토스페이먼츠 (테스트 키)
TOSS_SECRET_KEY="test_sk_..."
TOSS_WEBHOOK_SECRET=""
NEXT_PUBLIC_TOSS_CLIENT_KEY="test_ck_..."
```
- [ ] **Step 3: CheckoutForm 결제 배선** — 제출 핸들러를 변경: `checkout(shipping)`로 주문 `pending` 생성 후, 성공이면 Toss `requestPayment`로 결제창을 띄운다(리다이렉트). 실패면 기존 인라인 에러. (CartPanel의 done 화면은 success 페이지가 대체하므로 `onSubmit` 성공 분기에서 더 이상 done으로 보내지 않고 Toss로 넘긴다.)
```ts
// CheckoutForm 내부, 제출 시
import { loadTossPayments, ANONYMOUS } from "@tosspayments/tosspayments-sdk";
import { getSessionId } from "@/lib/session";
// ...
const result = await onSubmit({ recipient, phone, address, addressDetail, zipcode, memo });
if (!result.ok) { /* 기존 에러 처리 */ return; }
const { orderNumber, total, orderName } = result; // onSubmit이 주문정보를 반환하도록 확장
const toss = await loadTossPayments(process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!);
const payment = toss.payment({ customerKey: ANONYMOUS });
await payment.requestPayment({
  method: "CARD",
  amount: { currency: "KRW", value: total },
  orderId: orderNumber,
  orderName,
  successUrl: `${window.location.origin}/payments/success`,
  failUrl: `${window.location.origin}/payments/fail`,
  customerName: recipient,
});
```
  이를 위해 CartPanel의 `handleCheckout`/`checkout`가 성공 시 `{ ok:true, orderNumber, total, orderName }`를 반환하도록 타입을 확장(주문명은 첫 상품명 + "외 N건"). `mode==="done"` 전환은 제거(결제는 success 페이지에서 확정).
- [ ] **Step 4: success 페이지** — `web/src/app/payments/success/page.tsx`(`"use client"`): `useSearchParams`로 `paymentKey·orderId·amount` 읽어 `POST /api/payments/confirm`({ session_id: getSessionId(), paymentKey, orderId, amount: Number(amount) }) → 성공 시 결제 완료(주문번호·총액·`결제 완료`), 실패 시 에러 + 주문 취소 안내. `<Suspense>`로 감싼다(useSearchParams 요건).
- [ ] **Step 5: fail 페이지** — `web/src/app/payments/fail/page.tsx`(`"use client"`): `code·message·orderId` 표시 + "주문 취소(재고 복원)" 버튼(주문 id 필요 — orderId는 orderNumber이므로, 취소는 주문 상세 조회 후 id로 `/api/orders/[id]/cancel` 호출하거나, 간단히 안내만) + "다시 시도" 링크(홈). 프로토타입: 안내 + 홈 링크로 단순화 가능.
- [ ] **Step 6: 검증** — `cd web && npx tsc --noEmit` clean, `npm test` green(98+신규). UI 동작은 Task 7 라이브 스모크.
- [ ] **Step 7: 커밋** — `feat(web): 토스 결제창 + 결제 성공/실패 페이지 + 체크아웃 배선`

## Phase 6 — 스모크 + 문서

### Task 7: 라이브 스모크 + 문서

**Files:** Modify `docs/ROADMAP.md`, `README.md`

- [ ] **Step 1: 라이브 스모크**(테스트 키 설정 시) — `web/.env`에 토스 테스트 키 설정 후 `make restart`. 스토어에서 담기→체크아웃→**Toss 결제창에서 테스트 카드 결제**→success에서 `paid` 확인. `/admin`에서 주문 상태·재고 확인. 취소→환불(refunded)·재고 복원. 키 미설정이면 건너뛰고 보고. 웹훅은 대시보드 필요 — 미설정 시 단위테스트로만 검증됨을 보고.
- [ ] **Step 2: ROADMAP** — `docs/ROADMAP.md` E1 항목 3개 `- [x]`로(토스 연동, 승인·취소·환불+웹훅 서명검증·멱등, 서버측 금액 신뢰·카드정보 비저장). 부분취소·정기결제는 범위 밖 명기. 구현 링크 추가.
- [ ] **Step 3: README** — 장바구니·주문 기능 줄을 "장바구니·**결제**·주문"으로 확장(토스 테스트). 프로토타입 범위의 "실제 결제 미연동"을 "토스페이먼츠 **테스트 결제** 연동(실 키 교체 시 운영)"으로 갱신.
- [ ] **Step 4: 커밋** — `docs(commerce): E1 토스 결제 완료 반영`

## Self-Review

**Spec coverage:** 결제 컬럼/마이그레이션(T1) · Toss 클라이언트 confirm/cancel/get/서명검증(T2) · confirmPayment(금액대조·멱등·전이)+환불 cancelOrder+웹훅 재조정(T3) · /api/payments/confirm(T4) · webhook 서명검증(T5) · 클라 SDK+결제창+success/fail+배선(T6) · 스모크/문서(T7). 서버측 금액 신뢰·멱등·카드정보 비저장·재고 복원 모두 매핑.

**Placeholder scan:** 백엔드(T1–5) 전 코드 제공. 외부 의존(T6 SDK·T2/T5 Toss 엔드포인트·웹훅 헤더)은 "현행 문서로 확인" 플래그 — placeholder가 아니라 검증 지점. 라이브 스모크는 키 의존.

**Type consistency:** `CommerceCode`(+AMOUNT_MISMATCH/PAYMENT_FAILED)·`TossPayment`·`confirmPayment/cancelOrder/reconcileFromToss` 시그니처가 lib→API→테스트에서 일치. `commerceStatus` 매핑이 테스트 기대와 일치. cancelOrder 교체가 기존 orders.test와 호환(pending/double/owner).
