# 커머스 E3 — 배송 (어드민 발송 처리) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 약사 어드민에서 `paid` 주문에 택배사·송장번호를 입력해 `shipped → delivered`로 처리하고, 도서산간(제주) 배송비를 우편번호 접두로 자동 산정한다.

**Architecture:** `lib/orders.ts`에 배송 도메인 함수(computeShipping 확장·markShipped·markDelivered·listOrders·getOrderAdmin·trackingUrl)를 추가하고, 4개 어드민 API 라우트(목록·상세·ship·deliver)를 지식 베이스 탭 패턴으로 생성하며, AdminNav에 "주문 관리" 탭 + `/admin/orders` 페이지 + `AdminOrderItem` 컴포넌트로 어드민 UI를 완성한다. 고객용 화면은 E4.

**Tech Stack:** Next.js 16 (App Router, async params), Prisma 6/SQLite, vitest, Tailwind CSS.

## Global Constraints

- `Pharmacist`에 `email` 필드 없음 — 테스트 시드는 `{ name: "약사" }` only.
- 금액 정수 KRW. 부동소수 미사용.
- Next.js 16 async params: `{ params }: { params: Promise<{ id: string }> }` → `const { id } = await params`.
- 어드민 API 인증 없음(로드맵 A).
- 커밋 말미 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. `--no-verify` 금지.
- 테스트: `cd /Users/atinjin/repository/pham-consult/web && npm test`.
- 타입검사: `cd /Users/atinjin/repository/pham-consult/web && npx tsc --noEmit`.
- Git은 **repo root** `/Users/atinjin/repository/pham-consult`에서 실행.
- 전체 테스트 통과 수가 114개 이상이어야 함(기존 114 + 신규).

## File Map

| 파일 | 역할 |
|------|------|
| `web/prisma/schema.prisma` | Order에 carrier·trackingNumber·shippedAt·deliveredAt 추가 |
| `web/prisma/migrations/…` | nullable 컬럼 추가 마이그레이션 |
| `web/src/lib/orders.ts` | computeShipping 확장, isRemoteArea, REMOTE_AREA_FEE, trackingUrl, markShipped, markDelivered, listOrders, getOrderAdmin |
| `web/tests/shipping.test.ts` | 배송 도메인 함수 단위 테스트 |
| `web/src/app/api/admin/orders/route.ts` | GET 주문 목록 |
| `web/src/app/api/admin/orders/[id]/route.ts` | GET 주문 상세 |
| `web/src/app/api/admin/orders/[id]/ship/route.ts` | POST 발송 처리 |
| `web/src/app/api/admin/orders/[id]/deliver/route.ts` | POST 배송완료 |
| `web/tests/orders-admin-api.test.ts` | 어드민 API 테스트 |
| `web/src/components/AdminNav.tsx` | "주문 관리" 탭 추가 |
| `web/src/app/admin/orders/page.tsx` | 주문 관리 어드민 페이지 |
| `web/src/components/AdminOrderItem.tsx` | 주문 행 컴포넌트 |
| `web/src/components/store/CartPanel.tsx` | 도서산간 안내 문구 추가 |
| `docs/ROADMAP.md` | E3 체크박스 완료 |

---

## Phase 1 — 데이터 모델

### Task 1: Order 배송 컬럼 + 마이그레이션

**Files:**
- Modify: `web/prisma/schema.prisma`
- Create: `web/prisma/migrations/20260621…_order_shipping_fields/migration.sql` (자동 생성)

**Interfaces:**
- Produces: `Order.carrier String?`, `Order.trackingNumber String?`, `Order.shippedAt DateTime?`, `Order.deliveredAt DateTime?`

- [ ] **Step 1: 스키마에 컬럼 추가**

`web/prisma/schema.prisma`의 `model Order` 안에서 `pgProvider String?` 다음 줄에 추가:

```prisma
  carrier        String?
  trackingNumber String?
  shippedAt      DateTime?
  deliveredAt    DateTime?
```

완성된 Order 모델 끝부분:
```prisma
  paymentKey    String?
  paymentMethod String?
  paidAt        DateTime?
  pgProvider    String?
  carrier        String?
  trackingNumber String?
  shippedAt      DateTime?
  deliveredAt    DateTime?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
}
```

- [ ] **Step 2: 마이그레이션 실행**

```bash
cd /Users/atinjin/repository/pham-consult/web
npx prisma migrate dev --name order_shipping_fields
```

Expected: "The following migration(s) have been created and applied" — NOT "reset" 프롬프트. 리셋 요청이 뜨면 STOP하고 보고.

- [ ] **Step 3: tsc 확인**

```bash
cd /Users/atinjin/repository/pham-consult/web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: 커밋**

```bash
cd /Users/atinjin/repository/pham-consult
git add web/prisma/schema.prisma web/prisma/migrations/
git commit -m "feat(commerce): Order 배송 컬럼 추가(carrier·trackingNumber·shippedAt·deliveredAt)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — 도메인

### Task 2: 배송 도메인 함수 + 테스트

**Files:**
- Modify: `web/src/lib/orders.ts`
- Create: `web/tests/shipping.test.ts`

**Interfaces:**
- Consumes: `prisma`, `CommerceError` (기존)
- Produces:
  - `REMOTE_AREA_FEE: 3000`
  - `REMOTE_ZIP_PREFIXES: string[]`
  - `isRemoteArea(zipcode?: string): boolean`
  - `computeShipping(subtotal: number, zipcode?: string): number` ← 시그니처 변경
  - `TRACKING_CARRIERS: Record<string, string>` (label 맵)
  - `trackingUrl(carrier: string, trackingNumber: string): string | null`
  - `markShipped(orderId: number, data: { carrier: string; trackingNumber: string }): Promise<Order & { items: OrderItem[] }>`
  - `markDelivered(orderId: number): Promise<Order & { items: OrderItem[] }>`
  - `listOrders(opts: { status?: string; q?: string; skip: number; take: number }): Promise<{ rows: (Order & { items: OrderItem[] })[]; total: number }>`
  - `getOrderAdmin(id: number): Promise<(Order & { items: OrderItem[] }) | null>`

- [ ] **Step 1: 실패 테스트 작성**

`web/tests/shipping.test.ts` 생성:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { addItem } from "@/lib/cart";
import { placeOrder } from "@/lib/orders";
import {
  computeShipping,
  isRemoteArea,
  trackingUrl,
  markShipped,
  markDelivered,
  listOrders,
  getOrderAdmin,
  SHIPPING_FEE,
  FREE_SHIPPING_OVER,
  REMOTE_AREA_FEE,
} from "@/lib/orders";

let productId: number;
const SHIP = { recipient: "홍길동", phone: "010-0000-0000", address: "서울시 강남구" };
const SHIP_JEJU = { ...SHIP, zipcode: "63001" };

beforeEach(async () => {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  const ph = await prisma.pharmacist.create({ data: { name: "약사" } });
  productId = (
    await prisma.product.create({
      data: { pharmacistId: ph.id, name: "비타민C", price: 18000, stock: 20, isActive: true },
    })
  ).id;
});

// ─── computeShipping ───────────────────────────────────────────────
describe("computeShipping", () => {
  it("기본 배송비", () => {
    expect(computeShipping(10000)).toBe(SHIPPING_FEE);
  });

  it("무료 배송 임계 이상", () => {
    expect(computeShipping(FREE_SHIPPING_OVER)).toBe(0);
  });

  it("subtotal 0이면 0", () => {
    expect(computeShipping(0)).toBe(0);
  });

  it("일반 지역 + zipcode 무시", () => {
    expect(computeShipping(10000, "06234")).toBe(SHIPPING_FEE);
  });

  it("도서산간(제주) 기본 + 추가비", () => {
    expect(computeShipping(10000, "63001")).toBe(SHIPPING_FEE + REMOTE_AREA_FEE);
  });

  it("무료 임계 이상 + 도서산간 → 도서산간비만", () => {
    expect(computeShipping(FREE_SHIPPING_OVER, "63999")).toBe(REMOTE_AREA_FEE);
  });

  it("도서산간이지만 subtotal 0 → 0", () => {
    expect(computeShipping(0, "63001")).toBe(0);
  });
});

// ─── isRemoteArea ────────────────────────────────────────────────
describe("isRemoteArea", () => {
  it("제주 63 접두 → true", () => {
    expect(isRemoteArea("63001")).toBe(true);
    expect(isRemoteArea("63999")).toBe(true);
  });

  it("서울 06 → false", () => {
    expect(isRemoteArea("06234")).toBe(false);
  });

  it("undefined → false", () => {
    expect(isRemoteArea(undefined)).toBe(false);
  });

  it("빈 문자열 → false", () => {
    expect(isRemoteArea("")).toBe(false);
  });
});

// ─── trackingUrl ─────────────────────────────────────────────────
describe("trackingUrl", () => {
  it("CJ 딥링크에 송장번호 치환", () => {
    const url = trackingUrl("CJ", "1234567890");
    expect(url).toContain("1234567890");
    expect(url).toContain("cjlogistics.com");
  });

  it("LOTTE 딥링크", () => {
    const url = trackingUrl("LOTTE", "9999");
    expect(url).toContain("9999");
    expect(url).toContain("lotteglogis.com");
  });

  it("HANJIN 딥링크", () => {
    const url = trackingUrl("HANJIN", "1111");
    expect(url).toContain("1111");
    expect(url).toContain("hanjin.com");
  });

  it("POST 딥링크", () => {
    const url = trackingUrl("POST", "2222");
    expect(url).toContain("2222");
    expect(url).toContain("epost.go.kr");
  });

  it("LOGEN 딥링크", () => {
    const url = trackingUrl("LOGEN", "3333");
    expect(url).toContain("3333");
    expect(url).toContain("ilogen.com");
  });

  it("알 수 없는 택배사 → null", () => {
    expect(trackingUrl("UNKNOWN", "123")).toBeNull();
  });
});

// ─── markShipped / markDelivered ─────────────────────────────────
describe("markShipped", () => {
  async function paidOrder(sid: string) {
    const c = await resolveCustomer(sid);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, SHIP);
    // 결제 수동 완료(E1 없이 DB 직접)
    await prisma.order.update({ where: { id: order.id }, data: { status: "paid" } });
    return order;
  }

  it("paid → shipped, 택배사·송장·shippedAt 저장", async () => {
    const order = await paidOrder(`ship-${Date.now()}-1`);
    const shipped = await markShipped(order.id, { carrier: "CJ", trackingNumber: "1234567890" });
    expect(shipped.status).toBe("shipped");
    expect(shipped.carrier).toBe("CJ");
    expect(shipped.trackingNumber).toBe("1234567890");
    expect(shipped.shippedAt).not.toBeNull();
  });

  it("paid가 아닌 주문(pending) → INVALID_TRANSITION", async () => {
    const c = await resolveCustomer(`ship-${Date.now()}-2`);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, SHIP);
    await expect(markShipped(order.id, { carrier: "CJ", trackingNumber: "x" })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("없는 주문 → NOT_FOUND", async () => {
    await expect(markShipped(999999, { carrier: "CJ", trackingNumber: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("markDelivered", () => {
  async function shippedOrder(sid: string) {
    const c = await resolveCustomer(sid);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, SHIP);
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "shipped", carrier: "CJ", trackingNumber: "123", shippedAt: new Date() },
    });
    return order;
  }

  it("shipped → delivered, deliveredAt 저장", async () => {
    const order = await shippedOrder(`dlv-${Date.now()}-1`);
    const delivered = await markDelivered(order.id);
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAt).not.toBeNull();
  });

  it("shipped 아닌 주문(paid) → INVALID_TRANSITION", async () => {
    const c = await resolveCustomer(`dlv-${Date.now()}-2`);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, SHIP);
    await prisma.order.update({ where: { id: order.id }, data: { status: "paid" } });
    await expect(markDelivered(order.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

// ─── listOrders ──────────────────────────────────────────────────
describe("listOrders", () => {
  async function makeOrder(sid: string, status = "pending") {
    const c = await resolveCustomer(sid);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, { recipient: `수령인${sid.slice(-4)}`, phone: "010", address: "서울" });
    if (status !== "pending") await prisma.order.update({ where: { id: order.id }, data: { status } });
    return order;
  }

  it("전체 목록 반환", async () => {
    await makeOrder(`lst-${Date.now()}-1`);
    await makeOrder(`lst-${Date.now()}-2`, "paid");
    const { rows, total } = await listOrders({ skip: 0, take: 20 });
    expect(total).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("status 필터", async () => {
    await makeOrder(`lst-${Date.now()}-3`);
    await makeOrder(`lst-${Date.now()}-4`, "paid");
    const { rows } = await listOrders({ status: "paid", skip: 0, take: 20 });
    expect(rows.every((r) => r.status === "paid")).toBe(true);
  });

  it("q로 주문번호 검색", async () => {
    const order = await makeOrder(`lst-${Date.now()}-5`);
    const { rows } = await listOrders({ q: order.orderNumber.slice(4, 12), skip: 0, take: 20 });
    expect(rows.some((r) => r.id === order.id)).toBe(true);
  });

  it("페이징", async () => {
    await makeOrder(`lst-${Date.now()}-6`);
    await makeOrder(`lst-${Date.now()}-7`);
    const { rows } = await listOrders({ skip: 0, take: 1 });
    expect(rows.length).toBe(1);
  });
});

// ─── placeOrder + 도서산간 배송비 확정 ───────────────────────────
describe("placeOrder + zipcode", () => {
  it("제주 zipcode → shippingFee에 도서산간비 포함", async () => {
    const c = await resolveCustomer(`pz-${Date.now()}`);
    await addItem(c, productId, 1); // 18000원
    const order = await placeOrder(c, SHIP_JEJU);
    // 18000 < 50000 이므로 기본 3000 + 도서산간 3000 = 6000
    expect(order.shippingFee).toBe(SHIPPING_FEE + REMOTE_AREA_FEE);
    expect(order.total).toBe(18000 + SHIPPING_FEE + REMOTE_AREA_FEE);
  });

  it("서울 zipcode → 기본 배송비만", async () => {
    const c = await resolveCustomer(`pz2-${Date.now()}`);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, { ...SHIP, zipcode: "06234" });
    expect(order.shippingFee).toBe(SHIPPING_FEE);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/atinjin/repository/pham-consult/web
npm test -- shipping
```

Expected: FAIL — `isRemoteArea`, `trackingUrl` 등 미정의.

- [ ] **Step 3: orders.ts 확장**

`web/src/lib/orders.ts`에서 다음을 변경·추가한다.

**3-a. 상수·헬퍼 추가** (파일 상단 기존 상수 바로 아래):

```ts
export const REMOTE_AREA_FEE = 3000;
const REMOTE_ZIP_PREFIXES = ["63"];

export function isRemoteArea(zipcode?: string): boolean {
  if (!zipcode) return false;
  return REMOTE_ZIP_PREFIXES.some((p) => zipcode.startsWith(p));
}
```

**3-b. `computeShipping` 시그니처 변경** (기존 함수를 아래로 교체):

```ts
export function computeShipping(subtotal: number, zipcode?: string): number {
  if (subtotal <= 0) return 0;
  const base = subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE;
  const remote = isRemoteArea(zipcode) ? REMOTE_AREA_FEE : 0;
  return base + remote;
}
```

**3-c. `placeOrder` 내 `computeShipping` 호출 업데이트** (shipping.zipcode 전달):

기존:
```ts
    const shippingFee = computeShipping(subtotal);
```
변경:
```ts
    const shippingFee = computeShipping(subtotal, shipping.zipcode);
```

**3-d. `trackingUrl` 추가** (파일 하단, `reconcileFromToss` 아래):

```ts
const TRACKING_URL_TEMPLATES: Record<string, string> = {
  CJ: "https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo={no}",
  LOTTE: "https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo={no}",
  HANJIN: "https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillSch.do?mCode=MN038&schLang=KOR&wblnumText2={no}",
  POST: "https://service.epost.go.kr/trace.RetrieveEmsRigiTraceList.comm?POST_CODE={no}",
  LOGEN: "https://www.ilogen.com/web/personal/trace/{no}",
};

export const TRACKING_CARRIERS: Record<string, string> = {
  CJ: "CJ대한통운",
  LOTTE: "롯데택배",
  HANJIN: "한진택배",
  POST: "우체국택배",
  LOGEN: "로젠택배",
};

export function trackingUrl(carrier: string, trackingNumber: string): string | null {
  const tmpl = TRACKING_URL_TEMPLATES[carrier];
  if (!tmpl) return null;
  return tmpl.replace("{no}", encodeURIComponent(trackingNumber));
}
```

**3-e. `markShipped` 추가**:

```ts
export async function markShipped(
  orderId: number,
  data: { carrier: string; trackingNumber: string }
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new CommerceError("NOT_FOUND", "주문을 찾을 수 없습니다.");
  if (order.status !== "paid")
    throw new CommerceError("INVALID_TRANSITION", `발송 처리할 수 없는 상태입니다: ${order.status}`);
  return prisma.order.update({
    where: { id: orderId },
    data: { status: "shipped", carrier: data.carrier, trackingNumber: data.trackingNumber, shippedAt: new Date() },
    include: { items: true },
  });
}
```

**3-f. `markDelivered` 추가**:

```ts
export async function markDelivered(orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new CommerceError("NOT_FOUND", "주문을 찾을 수 없습니다.");
  if (order.status !== "shipped")
    throw new CommerceError("INVALID_TRANSITION", `배송완료 처리할 수 없는 상태입니다: ${order.status}`);
  return prisma.order.update({
    where: { id: orderId },
    data: { status: "delivered", deliveredAt: new Date() },
    include: { items: true },
  });
}
```

**3-g. `listOrders` 추가**:

```ts
export async function listOrders(opts: { status?: string; q?: string; skip: number; take: number }) {
  const { status, q, skip, take } = opts;
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { orderNumber: { contains: q } },
      { recipient: { contains: q } },
    ];
  }
  const [rows, total] = await prisma.$transaction([
    prisma.order.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: { items: true } }),
    prisma.order.count({ where }),
  ]);
  return { rows, total };
}
```

**3-h. `getOrderAdmin` 추가**:

```ts
export async function getOrderAdmin(id: number) {
  return prisma.order.findUnique({ where: { id }, include: { items: true } });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/atinjin/repository/pham-consult/web
npm test -- shipping
```

Expected: all green. 기존 테스트 회귀 없는지 전체 확인:

```bash
npm test -- orders
```

Expected: 기존 orders.test.ts 모두 green.

- [ ] **Step 5: tsc 확인**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: 커밋**

```bash
cd /Users/atinjin/repository/pham-consult
git add web/src/lib/orders.ts web/tests/shipping.test.ts
git commit -m "feat(commerce): 배송 도메인(computeShipping 도서산간·markShipped/Delivered·listOrders·trackingUrl)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3 — 어드민 API

### Task 3: 어드민 주문 API 4개 라우트 + 테스트

**Files:**
- Create: `web/src/app/api/admin/orders/route.ts`
- Create: `web/src/app/api/admin/orders/[id]/route.ts`
- Create: `web/src/app/api/admin/orders/[id]/ship/route.ts`
- Create: `web/src/app/api/admin/orders/[id]/deliver/route.ts`
- Create: `web/tests/orders-admin-api.test.ts`

**Interfaces:**
- Consumes: `listOrders`, `getOrderAdmin`, `markShipped`, `markDelivered`, `CommerceError`, `commerceStatus`
- Produces: `GET /api/admin/orders`, `GET /api/admin/orders/[id]`, `POST /api/admin/orders/[id]/ship`, `POST /api/admin/orders/[id]/deliver`

- [ ] **Step 1: 실패 테스트 작성**

`web/tests/orders-admin-api.test.ts` 생성:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { addItem } from "@/lib/cart";
import { placeOrder } from "@/lib/orders";
import { GET as list } from "@/app/api/admin/orders/route";
import { GET as getOne } from "@/app/api/admin/orders/[id]/route";
import { POST as ship } from "@/app/api/admin/orders/[id]/ship/route";
import { POST as deliver } from "@/app/api/admin/orders/[id]/deliver/route";

let productId: number;
const SHIP = { recipient: "홍길동", phone: "010-1234-5678", address: "서울시 강남구" };

beforeEach(async () => {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  const ph = await prisma.pharmacist.create({ data: { name: "약사" } });
  productId = (
    await prisma.product.create({
      data: { pharmacistId: ph.id, name: "비타민C", price: 18000, stock: 20, isActive: true },
    })
  ).id;
});

function get(url: string) {
  return new NextRequest(url);
}
function post(url: string, body: unknown = {}) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function makeOrderWithStatus(sid: string, status: string) {
  const c = await resolveCustomer(sid);
  await addItem(c, productId, 1);
  const order = await placeOrder(c, SHIP);
  if (status !== "pending") await prisma.order.update({ where: { id: order.id }, data: { status } });
  return order;
}

describe("GET /api/admin/orders", () => {
  it("전체 목록 반환", async () => {
    await makeOrderWithStatus(`adm-${Date.now()}-1`, "pending");
    await makeOrderWithStatus(`adm-${Date.now()}-2`, "paid");
    const res = await list(get("http://localhost/api/admin/orders?page=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.rows.length).toBeGreaterThanOrEqual(2);
    expect(body.pageSize).toBe(20);
  });

  it("status 필터", async () => {
    await makeOrderWithStatus(`adm-${Date.now()}-3`, "pending");
    await makeOrderWithStatus(`adm-${Date.now()}-4`, "paid");
    const res = await list(get("http://localhost/api/admin/orders?status=paid"));
    const body = await res.json();
    expect(body.rows.every((r: { status: string }) => r.status === "paid")).toBe(true);
  });
});

describe("GET /api/admin/orders/[id]", () => {
  it("주문 상세 반환", async () => {
    const order = await makeOrderWithStatus(`adm-${Date.now()}-5`, "pending");
    const res = await getOne(get(`http://localhost/api/admin/orders/${order.id}`), ctx(order.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orderNumber).toBe(order.orderNumber);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("없는 주문 404", async () => {
    const res = await getOne(get("http://localhost/api/admin/orders/999999"), ctx(999999));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/orders/[id]/ship", () => {
  it("paid → shipped 200", async () => {
    const order = await makeOrderWithStatus(`adm-${Date.now()}-6`, "paid");
    const res = await ship(
      post(`http://localhost/api/admin/orders/${order.id}/ship`, {
        carrier: "CJ",
        trackingNumber: "1234567890",
      }),
      ctx(order.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("shipped");
    expect(body.carrier).toBe("CJ");
    expect(body.trackingNumber).toBe("1234567890");
  });

  it("paid가 아닌 주문(pending) → 409", async () => {
    const order = await makeOrderWithStatus(`adm-${Date.now()}-7`, "pending");
    const res = await ship(
      post(`http://localhost/api/admin/orders/${order.id}/ship`, {
        carrier: "CJ",
        trackingNumber: "x",
      }),
      ctx(order.id)
    );
    expect(res.status).toBe(409);
  });

  it("carrier 누락 → 400", async () => {
    const order = await makeOrderWithStatus(`adm-${Date.now()}-8`, "paid");
    const res = await ship(
      post(`http://localhost/api/admin/orders/${order.id}/ship`, { trackingNumber: "x" }),
      ctx(order.id)
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/orders/[id]/deliver", () => {
  it("shipped → delivered 200", async () => {
    const order = await makeOrderWithStatus(`adm-${Date.now()}-9`, "shipped");
    await prisma.order.update({
      where: { id: order.id },
      data: { carrier: "CJ", trackingNumber: "123", shippedAt: new Date() },
    });
    const res = await deliver(post(`http://localhost/api/admin/orders/${order.id}/deliver`), ctx(order.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("delivered");
  });

  it("shipped 아닌 주문(paid) → 409", async () => {
    const order = await makeOrderWithStatus(`adm-${Date.now()}-10`, "paid");
    const res = await deliver(post(`http://localhost/api/admin/orders/${order.id}/deliver`), ctx(order.id));
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/atinjin/repository/pham-consult/web
npm test -- orders-admin-api
```

Expected: FAIL — 라우트 모듈 없음.

- [ ] **Step 3: `GET /api/admin/orders` 구현**

`web/src/app/api/admin/orders/route.ts` 생성:

```ts
import { NextRequest, NextResponse } from "next/server";
import { listOrders } from "@/lib/orders";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") || undefined;
  const q = sp.get("q") || undefined;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const take = 20;
  const { rows, total } = await listOrders({ status, q, skip: (page - 1) * take, take });
  return NextResponse.json({ rows, total, page, pageSize: take });
}
```

- [ ] **Step 4: `GET /api/admin/orders/[id]` 구현**

`web/src/app/api/admin/orders/[id]/route.ts` 생성:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getOrderAdmin } from "@/lib/orders";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const order = await getOrderAdmin(Number(id));
  if (!order) return NextResponse.json({ error: "주문을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(order);
}
```

- [ ] **Step 5: `POST /api/admin/orders/[id]/ship` 구현**

`web/src/app/api/admin/orders/[id]/ship/route.ts` 생성:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { markShipped } from "@/lib/orders";
import { CommerceError, commerceStatus } from "@/lib/commerceErrors";

const schema = z.object({
  carrier: z.string().min(1),
  trackingNumber: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const p = schema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  try {
    const order = await markShipped(Number(id), p.data);
    return NextResponse.json(order);
  } catch (e) {
    if (e instanceof CommerceError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: commerceStatus(e.code) });
    return NextResponse.json({ error: "발송 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 6: `POST /api/admin/orders/[id]/deliver` 구현**

`web/src/app/api/admin/orders/[id]/deliver/route.ts` 생성:

```ts
import { NextRequest, NextResponse } from "next/server";
import { markDelivered } from "@/lib/orders";
import { CommerceError, commerceStatus } from "@/lib/commerceErrors";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const order = await markDelivered(Number(id));
    return NextResponse.json(order);
  } catch (e) {
    if (e instanceof CommerceError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: commerceStatus(e.code) });
    return NextResponse.json({ error: "배송완료 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 7: 테스트 통과 확인**

```bash
cd /Users/atinjin/repository/pham-consult/web
npm test -- orders-admin-api
```

Expected: all green (10 tests).

- [ ] **Step 8: tsc + 전체 테스트**

```bash
npx tsc --noEmit
npm test
```

Expected: tsc clean, 전체 green (130+ tests).

- [ ] **Step 9: 커밋**

```bash
cd /Users/atinjin/repository/pham-consult
git add web/src/app/api/admin/orders/ web/tests/orders-admin-api.test.ts
git commit -m "feat(commerce): 어드민 주문 API(목록·상세·ship·deliver)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 4 — 어드민 UI

### Task 4: AdminNav 탭 + 주문 관리 페이지 + AdminOrderItem + CartPanel 안내

**Files:**
- Modify: `web/src/components/AdminNav.tsx`
- Create: `web/src/app/admin/orders/page.tsx`
- Create: `web/src/components/AdminOrderItem.tsx`
- Modify: `web/src/components/store/CartPanel.tsx`

**Interfaces:**
- Consumes: `/api/admin/orders`, `trackingUrl`, `TRACKING_CARRIERS` (내부 fetch)
- No new backend interfaces.

- [ ] **Step 1: AdminNav에 "주문 관리" 탭 추가**

`web/src/components/AdminNav.tsx`의 TABS 배열에 항목 추가:

```ts
const TABS = [
  { href: "/admin", label: "상품 관리" },
  { href: "/admin/agent", label: "에이전트 설정" },
  { href: "/admin/skills", label: "상담 스킬" },
  { href: "/admin/knowledge", label: "지식 베이스" },
  { href: "/admin/orders", label: "주문 관리" },
];
```

- [ ] **Step 2: `AdminOrderItem` 컴포넌트 생성**

`web/src/components/AdminOrderItem.tsx` 생성:

```tsx
"use client";
import { useState } from "react";

// 서버 lib를 클라이언트에 임포트하면 Prisma가 번들에 포함되므로, 상수를 인라인 복사
const TRACKING_URL_TEMPLATES: Record<string, string> = {
  CJ: "https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo={no}",
  LOTTE: "https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo={no}",
  HANJIN: "https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillSch.do?mCode=MN038&schLang=KOR&wblnumText2={no}",
  POST: "https://service.epost.go.kr/trace.RetrieveEmsRigiTraceList.comm?POST_CODE={no}",
  LOGEN: "https://www.ilogen.com/web/personal/trace/{no}",
};
const CARRIER_LABELS: Record<string, string> = {
  CJ: "CJ대한통운", LOTTE: "롯데택배", HANJIN: "한진택배", POST: "우체국택배", LOGEN: "로젠택배",
};
function getTrackingUrl(carrier: string, no: string) {
  const t = TRACKING_URL_TEMPLATES[carrier];
  return t ? t.replace("{no}", encodeURIComponent(no)) : null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "결제 대기", paid: "결제 완료", shipped: "배송 중",
  delivered: "배송 완료", cancelled: "취소됨", refunded: "환불됨",
};
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  paid: "bg-blue-100 text-blue-700",
  shipped: "bg-amber-100 text-amber-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
  refunded: "bg-purple-100 text-purple-700",
};

export type AdminOrderRow = {
  id: number;
  orderNumber: string;
  status: string;
  recipient: string;
  phone: string;
  address: string;
  addressDetail?: string | null;
  zipcode?: string | null;
  memo?: string | null;
  subtotal: number;
  shippingFee: number;
  total: number;
  paidAt?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  items: { id: number; productName: string; unitPrice: number; quantity: number; lineTotal: number }[];
};

export function AdminOrderItem({
  order,
  onChanged,
}: {
  order: AdminOrderRow;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [shipForm, setShipForm] = useState(false);
  const [carrier, setCarrier] = useState("CJ");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRemoteZip = order.zipcode?.startsWith("63");
  const tUrl =
    order.carrier && order.trackingNumber ? getTrackingUrl(order.carrier, order.trackingNumber) : null;

  async function handleShip() {
    if (!trackingNumber.trim()) { setError("송장번호를 입력하세요."); return; }
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/orders/${order.id}/ship`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrier, trackingNumber: trackingNumber.trim() }),
    });
    setBusy(false);
    if (res.ok) { setShipForm(false); setTrackingNumber(""); onChanged(); }
    else { const d = await res.json(); setError(d.error ?? "오류가 발생했습니다."); }
  }

  async function handleDeliver() {
    if (!confirm("배송완료로 처리하시겠습니까?")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/orders/${order.id}/deliver`, { method: "POST" });
    setBusy(false);
    if (res.ok) onChanged();
  }

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-5 py-4 shadow-sm">
      {/* 요약 행 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-slate-800">{order.orderNumber}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[order.status] ?? "bg-slate-100 text-slate-600"}`}
            >
              {STATUS_LABELS[order.status] ?? order.status}
            </span>
            {isRemoteZip && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
                도서산간
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[12px] text-slate-500">
            <span>{order.recipient} {order.phone}</span>
            <span>합계 {order.total.toLocaleString()}원</span>
            {order.paidAt && <span>결제 {new Date(order.paidAt).toLocaleDateString("ko-KR")}</span>}
            {order.carrier && order.trackingNumber && (
              <span>{CARRIER_LABELS[order.carrier] ?? order.carrier} {order.trackingNumber}</span>
            )}
          </div>
        </button>

        {/* 액션 */}
        <div className="flex shrink-0 flex-wrap gap-2">
          {order.status === "paid" && !shipForm && (
            <button
              onClick={() => setShipForm(true)}
              className="rounded-full bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-blue-700"
            >
              송장 입력
            </button>
          )}
          {order.status === "shipped" && (
            <>
              {tUrl && (
                <a
                  href={tUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  배송 추적
                </a>
              )}
              <button
                onClick={handleDeliver}
                disabled={busy}
                className="rounded-full bg-green-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                배송완료
              </button>
            </>
          )}
          {order.status === "delivered" && tUrl && (
            <a
              href={tUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-slate-300 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              배송 추적
            </a>
          )}
        </div>
      </div>

      {/* 송장 입력 폼 */}
      {shipForm && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500">택배사</label>
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] outline-none focus:border-indigo-400"
            >
              {Object.entries(CARRIER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="mb-1 block text-[11px] font-medium text-slate-500">송장번호</label>
            <input
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="1234567890"
              className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] outline-none focus:border-indigo-400"
            />
          </div>
          <button
            onClick={handleShip}
            disabled={busy}
            className="rounded-full bg-blue-600 px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? "처리 중…" : "발송 처리"}
          </button>
          <button
            onClick={() => { setShipForm(false); setError(null); }}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-[12px] text-slate-500"
          >
            취소
          </button>
          {error && <p className="w-full text-[12px] text-red-500">{error}</p>}
        </div>
      )}

      {/* 펼치기: 상품 + 배송지 */}
      {open && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-1 text-[11px] font-semibold text-slate-500">주문 상품</p>
          <ul className="mb-3 space-y-1">
            {order.items.map((it) => (
              <li key={it.id} className="flex justify-between text-[12px] text-slate-700">
                <span>{it.productName} × {it.quantity}</span>
                <span>{it.lineTotal.toLocaleString()}원</span>
              </li>
            ))}
          </ul>
          <p className="mb-1 text-[11px] font-semibold text-slate-500">배송지</p>
          <p className="text-[12px] text-slate-700">
            {order.address}{order.addressDetail ? ` ${order.addressDetail}` : ""}
            {order.zipcode ? ` (${order.zipcode})` : ""}
          </p>
          {order.memo && <p className="mt-1 text-[12px] text-slate-500">메모: {order.memo}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `/admin/orders/page.tsx` 생성**

`web/src/app/admin/orders/page.tsx` 생성:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { AdminOrderItem, type AdminOrderRow } from "@/components/AdminOrderItem";

const STATUS_OPTIONS = [
  { value: "", label: "전체" },
  { value: "pending", label: "결제 대기" },
  { value: "paid", label: "결제 완료" },
  { value: "shipped", label: "배송 중" },
  { value: "delivered", label: "배송 완료" },
  { value: "cancelled", label: "취소됨" },
  { value: "refunded", label: "환불됨" },
];

export default function AdminOrdersPage() {
  const [rows, setRows] = useState<AdminOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (q.trim()) sp.set("q", q.trim());
    sp.set("page", String(page));
    const res = await fetch(`/api/admin/orders?${sp.toString()}`);
    const data = await res.json();
    setRows(data.rows);
    setTotal(data.total);
    setPageSize(data.pageSize);
  }, [status, q, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, q]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      {/* 필터 */}
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="주문번호 / 수령인 검색"
          className="glass rounded-full px-4 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="glass rounded-full px-4 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* 카운트 */}
      <p className="mb-3 text-[12px] text-slate-400">전체 {total}건</p>

      {/* 목록 */}
      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">주문이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((order) => (
            <AdminOrderItem key={order.id} order={order} onChanged={load} />
          ))}
        </div>
      )}

      {/* 페이징 */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="glass rounded-full px-4 py-1.5 text-sm text-slate-600 disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-sm text-slate-500">{page} / {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="glass rounded-full px-4 py-1.5 text-sm text-slate-600 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: CartPanel 도서산간 안내 추가**

`web/src/components/store/CartPanel.tsx`에서 배송비 표시 줄(`<span>무료</span>` 또는 `배송비 ${shipping.toLocaleString()}원`) 아래, `합계` 줄 바로 위에 안내 문구 삽입:

```tsx
              {/* 도서산간 안내 */}
              {subtotal > 0 && (
                <p className="text-[11px] text-slate-400">
                  * 제주·도서산간 지역은 추가 배송비가 부과될 수 있습니다.
                </p>
              )}
```

정확한 삽입 위치 — `CartPanel.tsx`에서 이 블록을 찾아 그 사이에 넣는다:

```tsx
              <div className="flex justify-between text-slate-500">
                <span>배송비</span>
                <span>{shipping === 0 ? "무료" : `${shipping.toLocaleString()}원`}</span>
              </div>
              {/* ← 여기에 삽입 */}
              <div className="flex justify-between pt-1 text-[15px] font-bold text-slate-900">
```

- [ ] **Step 5: tsc 확인**

```bash
cd /Users/atinjin/repository/pham-consult/web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: 전체 테스트**

```bash
npm test
```

Expected: 모두 green.

- [ ] **Step 7: 커밋**

```bash
cd /Users/atinjin/repository/pham-consult
git add web/src/components/AdminNav.tsx web/src/app/admin/orders/ web/src/components/AdminOrderItem.tsx web/src/components/store/CartPanel.tsx
git commit -m "feat(web): 주문 관리 어드민 탭 + AdminOrderItem + CartPanel 도서산간 안내

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 5 — 문서

### Task 5: ROADMAP E3 완료 표기

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: ROADMAP.md E3 섹션 업데이트**

`docs/ROADMAP.md`에서 E3 섹션을 아래로 교체:

```markdown
#### E3. 배송 ✅

- [x] **어드민 발송 처리** — 약사가 어드민 "주문 관리" 탭에서 `paid` 주문에 택배사·송장번호 입력 → `shipped`. "배송완료" 버튼으로 `delivered`. 택배사별 공개 추적 딥링크(키·연동 없음).
- [x] **도서산간 배송비** — `computeShipping(subtotal, zipcode)` 확장. 제주(63 접두) 자동 감지 → +3,000원 추가(무료 임계 이상도 별도 부과). CartPanel 미리보기에 안내 문구.
- [x] **주문 상태 머신 확장** — `paid → shipped → delivered`. 취소는 `paid`까지만(shipped·delivered에선 INVALID_TRANSITION). 기존 pending/cancelled/refunded 불변.
- 구현: [spec](superpowers/specs/2026-06-21-commerce-shipping-design.md) · [plan](superpowers/plans/2026-06-21-commerce-shipping.md). 실 추적 API·고객용 추적 화면은 E4 이후. 도서산간 전수 목록은 E6 운영.
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/atinjin/repository/pham-consult
git add docs/ROADMAP.md
git commit -m "docs(commerce): E3 배송 완료 반영

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Order.carrier/trackingNumber/shippedAt/deliveredAt 컬럼 (Task 1)
- ✅ REMOTE_AREA_FEE·REMOTE_ZIP_PREFIXES·isRemoteArea (Task 2)
- ✅ computeShipping(subtotal, zipcode?) (Task 2)
- ✅ trackingUrl (Task 2)
- ✅ markShipped·markDelivered (Task 2)
- ✅ listOrders·getOrderAdmin (Task 2)
- ✅ placeOrder zipcode 전달 (Task 2 Step 3-c)
- ✅ GET/ship/deliver/detail API (Task 3)
- ✅ AdminNav "주문 관리" 탭 (Task 4)
- ✅ AdminOrderItem (Task 4)
- ✅ /admin/orders/page.tsx (Task 4)
- ✅ CartPanel 도서산간 안내 (Task 4)
- ✅ ROADMAP 문서 (Task 5)
- ✅ 상태 머신(shipped/delivered에서 취소 불가)는 기존 cancelOrder 화이트리스트["pending","paid"]가 이미 처리

**2. Placeholder scan:** 없음. 모든 코드 블록 완성.

**3. Type consistency:**
- `markShipped(orderId: number, data: { carrier: string; trackingNumber: string })` → Task 2 정의, Task 3 ship 라우트에서 동일하게 사용.
- `listOrders({ status?, q?, skip, take })` → Task 2 정의, Task 3 GET 라우트에서 동일하게 사용.
- `AdminOrderRow` 타입 → Task 4 AdminOrderItem에서 정의, page.tsx에서 import해 사용.
- `TRACKING_URL_TEMPLATES`는 서버(`orders.ts`)와 클라이언트(`AdminOrderItem.tsx`)에 각각 인라인 — Prisma 번들 방지를 위한 의도적 복사(스펙 설계).
