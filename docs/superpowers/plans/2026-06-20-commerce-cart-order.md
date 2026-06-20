# 커머스 E2 — 장바구니·주문·재고 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 서버 영속 장바구니 → 완결형 주문(배송지 스냅샷) → 트랜잭션 기반 재고 차감(오버셀 방지)을 구축한다(결제 직전 `pending`까지).

**Architecture:** Prisma에 `Cart`/`CartItem`/`OrderItem` 추가 + `Order` 재설계. `lib/cart.ts`·`lib/orders.ts`가 도메인 로직(재고 차감은 `prisma.$transaction` + 조건부 `updateMany`), `/api/cart`·`/api/orders`가 `resolveCustomer(session_id)`로 고객을 잇는다. 클라이언트는 `StoreProvider`가 서버 장바구니를 동기화하고 `CartPanel`/`CheckoutForm`으로 주문한다.

**Tech Stack:** Next.js 16(App Router), Prisma 6 + SQLite, Zod 4, React 19 + Zustand-식 Context, vitest.

## Global Constraints

- 금액은 정수 KRW(원). 부동소수 미사용. 주문 항목은 주문 시점 `productName`·`unitPrice` 스냅샷.
- 재고 차감은 반드시 `prisma.$transaction`(인터랙티브) 안에서 조건부 `updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } })` → `count===0`이면 throw(롤백). 부분 차감 금지.
- 고객 해석은 `resolveCustomer(session_id)`(`@/lib/customers`) 재사용. 라우트는 내부/Prisma 에러 메시지 비노출.
- 주문 상태: 생성 시 `pending`. `paid` 전이·결제정보는 E1(범위 밖).
- 배송비 상수: `SHIPPING_FEE = 3000`, `FREE_SHIPPING_OVER = 50000`(subtotal≥ → 0, subtotal 0 → 0).
- web 테스트: `cd web && npm test`(vitest). 라우트는 `new NextRequest(...)`로 직접 호출. 동적 라우트는 `ctx = (id) => ({ params: Promise.resolve({ id: String(id) }) })`.
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## 파일 구조

- `web/prisma/schema.prisma` — Cart/CartItem/Order/OrderItem + 관계 (Task 1)
- `web/src/lib/commerceErrors.ts` — `CommerceError` + `commerceStatus` (Task 2)
- `web/src/lib/cart.ts` — 장바구니 도메인 (Task 2)
- `web/src/lib/orders.ts` — 주문/재고/배송비 도메인 (Task 3)
- `web/src/app/api/cart/route.ts` — 장바구니 API (Task 4)
- `web/src/app/api/orders/route.ts` — 체크아웃 (Task 5, 기존 대체)
- `web/src/app/api/orders/[id]/route.ts` · `.../[id]/cancel/route.ts` — 주문 상세·취소 (Task 5)
- `web/src/lib/session.ts` — `getSessionId()` 클라 헬퍼 (Task 6)
- `web/src/components/store/StoreProvider.tsx` — 장바구니 상태/액션 (Task 6)
- `web/src/components/ProductCard.tsx` — "담기"→addToCart + 배지 (Task 7)
- `web/src/components/store/CartPanel.tsx` · `CheckoutForm.tsx` — 장바구니/주문 UI (Task 8)
- `docs/ROADMAP.md` · `README.md` — 문서 (Task 9)

---

### Task 1: Prisma 스키마 — Cart/CartItem/Order 재설계/OrderItem + 마이그레이션

**Files:** Modify `web/prisma/schema.prisma`, `web/src/app/api/orders/route.ts`(임시 스텁); Test `web/tests/commerce-schema.test.ts`

**Interfaces (produces):** Prisma 모델 `Cart`(customerId @unique)·`CartItem`(@@unique([cartId,productId]))·`Order`(orderNumber·customerId·status·subtotal·shippingFee·discount·total·배송지 스냅샷)·`OrderItem`(productName·unitPrice·quantity·lineTotal). `Customer.cart`·`Customer.orders`·`Product.cartItems`·`Product.orderItems`.

- [ ] **Step 1: 스키마 편집** — `web/prisma/schema.prisma`에서 `Order` 모델을 아래로 교체하고 신규 모델 추가:

```prisma
model Order {
  id            Int         @id @default(autoincrement())
  orderNumber   String      @unique
  customer      Customer    @relation(fields: [customerId], references: [id])
  customerId    Int
  items         OrderItem[]
  status        String      @default("pending")
  subtotal      Int
  shippingFee   Int         @default(0)
  discount      Int         @default(0)
  total         Int
  recipient     String
  phone         String
  address       String
  addressDetail String?
  zipcode       String?
  memo          String?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
}

model OrderItem {
  id          Int     @id @default(autoincrement())
  order       Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  orderId     Int
  product     Product @relation(fields: [productId], references: [id])
  productId   Int
  productName String
  unitPrice   Int
  quantity    Int
  lineTotal   Int
}

model Cart {
  id         Int        @id @default(autoincrement())
  customer   Customer   @relation(fields: [customerId], references: [id])
  customerId Int        @unique
  items      CartItem[]
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt
}

model CartItem {
  id        Int     @id @default(autoincrement())
  cart      Cart    @relation(fields: [cartId], references: [id], onDelete: Cascade)
  cartId    Int
  product   Product @relation(fields: [productId], references: [id])
  productId Int
  quantity  Int     @default(1)
  @@unique([cartId, productId])
}
```
  그리고 `Customer` 모델에 `cart Cart?`와 `orders Order[]` 추가, `Product` 모델에 `cartItems CartItem[]`와 `orderItems OrderItem[]` 추가. (기존 `Product.orders Order[]` 관계 라인은 제거 — 이제 Order는 product를 직접 참조하지 않고 OrderItem을 통해 참조.)

- [ ] **Step 2: 기존 주문 라우트 임시 스텁** — `web/src/app/api/orders/route.ts`를 컴파일만 되게 임시 교체(실제 체크아웃은 Task 5):

```ts
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "체크아웃은 준비 중입니다." }, { status: 501 });
}
```

- [ ] **Step 3: 마이그레이션 적용** — 기존 `Order` 행이 없어야 함(프로토타입, 실주문 없음). 있다면 먼저 비운다.

Run: `cd web && npx prisma migrate dev --name commerce_cart_order`
Expected: 마이그레이션 생성·적용, `prisma generate` 완료. (데이터 손실 경고가 뜨면 dev 데이터이므로 승인.)

- [ ] **Step 4: 라운드트립 테스트 작성** — `web/tests/commerce-schema.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";

async function seedPharmacistProduct() {
  const ph = await prisma.pharmacist.create({ data: { name: "약사", email: `p${Date.now()}@x.com` } });
  const product = await prisma.product.create({
    data: { pharmacistId: ph.id, name: "비타민C", price: 12000, stock: 5, isActive: true },
  });
  return product;
}

beforeEach(async () => {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
});

describe("commerce schema", () => {
  it("cart + cartItem 라운드트립", async () => {
    const product = await seedPharmacistProduct();
    const customer = await prisma.customer.create({ data: {} });
    const cart = await prisma.cart.create({ data: { customerId: customer.id } });
    await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, quantity: 2 } });
    const got = await prisma.cart.findUnique({ where: { customerId: customer.id }, include: { items: true } });
    expect(got!.items[0].quantity).toBe(2);
  });

  it("order + orderItem 라운드트립", async () => {
    const product = await seedPharmacistProduct();
    const customer = await prisma.customer.create({ data: {} });
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-TEST-${Date.now()}`, customerId: customer.id,
        subtotal: 24000, shippingFee: 3000, total: 27000,
        recipient: "홍길동", phone: "010-0000-0000", address: "서울시",
        items: { create: [{ productId: product.id, productName: "비타민C", unitPrice: 12000, quantity: 2, lineTotal: 24000 }] },
      },
      include: { items: true },
    });
    expect(order.status).toBe("pending");
    expect(order.items[0].lineTotal).toBe(24000);
  });
});
```
   (`Pharmacist`의 정확한 필드는 `web/prisma/seed.ts` 참고해 맞출 것 — name/email 가정.)

- [ ] **Step 5: 검증** — Run `cd web && npm test -- commerce-schema` → 2 passed. Run `npx tsc --noEmit` → clean(스텁 라우트 컴파일).

- [ ] **Step 6: 커밋**

```bash
git add web/prisma/schema.prisma web/prisma/migrations web/src/app/api/orders/route.ts web/tests/commerce-schema.test.ts
git commit -m "feat(commerce): Cart/CartItem·Order 재설계/OrderItem 스키마 + 마이그레이션

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `lib/commerceErrors.ts` + `lib/cart.ts`

**Files:** Create `web/src/lib/commerceErrors.ts`, `web/src/lib/cart.ts`; Test `web/tests/cart.test.ts`

**Interfaces (produces):**
- `class CommerceError extends Error { code: CommerceCode; detail?: unknown }`, `commerceStatus(code): number`.
- `getOrCreateCart(customerId)`, `getCart(customerId): Promise<CartView>`, `addItem(customerId, productId, quantity=1)`, `setQuantity(customerId, productId, quantity)`, `removeItem(customerId, productId)`, `clearCart(customerId)`. `CartView = { items: {productId,name,price,quantity,lineTotal,isActive,stock}[], subtotal }`.

- [ ] **Step 1: 실패 테스트** — `web/tests/cart.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { getCart, addItem, setQuantity, removeItem, clearCart } from "@/lib/cart";

let productId: number;
let inactiveId: number;

beforeEach(async () => {
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  const ph = await prisma.pharmacist.create({ data: { name: "약사", email: `p${Date.now()}@x.com` } });
  productId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "오메가3", price: 20000, stock: 10, isActive: true } })).id;
  inactiveId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "비활성", price: 5000, stock: 3, isActive: false } })).id;
});

describe("cart", () => {
  it("addItem: 신규 추가 후 같은 상품은 수량 가산", async () => {
    const c = await resolveCustomer(`s-${Date.now()}-a`);
    await addItem(c, productId, 1);
    const view = await addItem(c, productId, 2);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].quantity).toBe(3);
    expect(view.items[0].lineTotal).toBe(60000);
    expect(view.subtotal).toBe(60000);
  });

  it("addItem: 비활성 상품은 INACTIVE 에러", async () => {
    const c = await resolveCustomer(`s-${Date.now()}-b`);
    await expect(addItem(c, inactiveId, 1)).rejects.toMatchObject({ code: "INACTIVE" });
  });

  it("addItem: 없는 상품은 NOT_FOUND 에러", async () => {
    const c = await resolveCustomer(`s-${Date.now()}-c`);
    await expect(addItem(c, 999999, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("setQuantity: 0이면 제거", async () => {
    const c = await resolveCustomer(`s-${Date.now()}-d`);
    await addItem(c, productId, 2);
    const view = await setQuantity(c, productId, 0);
    expect(view.items).toHaveLength(0);
    expect(view.subtotal).toBe(0);
  });

  it("removeItem / clearCart", async () => {
    const c = await resolveCustomer(`s-${Date.now()}-e`);
    await addItem(c, productId, 1);
    await removeItem(c, productId);
    expect((await getCart(c)).items).toHaveLength(0);
    await addItem(c, productId, 1);
    await clearCart(c);
    expect((await getCart(c)).items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd web && npm test -- cart` → 모듈 없음 실패.

- [ ] **Step 3: 구현** — `web/src/lib/commerceErrors.ts`:

```ts
export type CommerceCode = "NOT_FOUND" | "INACTIVE" | "EMPTY_CART" | "OUT_OF_STOCK" | "INVALID_TRANSITION";

export class CommerceError extends Error {
  constructor(public code: CommerceCode, message: string, public detail?: unknown) {
    super(message);
    this.name = "CommerceError";
  }
}

export function commerceStatus(code: CommerceCode): number {
  switch (code) {
    case "NOT_FOUND": return 404;
    case "OUT_OF_STOCK":
    case "INVALID_TRANSITION": return 409;
    default: return 400; // INACTIVE, EMPTY_CART
  }
}
```
  `web/src/lib/cart.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { CommerceError } from "@/lib/commerceErrors";

export type CartView = {
  items: { productId: number; name: string; price: number; quantity: number; lineTotal: number; isActive: boolean; stock: number }[];
  subtotal: number;
};

export async function getOrCreateCart(customerId: number) {
  return prisma.cart.upsert({ where: { customerId }, create: { customerId }, update: {} });
}

export async function getCart(customerId: number): Promise<CartView> {
  const cart = await prisma.cart.findUnique({
    where: { customerId },
    include: { items: { include: { product: true }, orderBy: { id: "asc" } } },
  });
  const items = (cart?.items ?? []).map((it) => ({
    productId: it.productId, name: it.product.name, price: it.product.price,
    quantity: it.quantity, lineTotal: it.product.price * it.quantity,
    isActive: it.product.isActive, stock: it.product.stock,
  }));
  return { items, subtotal: items.reduce((s, it) => s + it.lineTotal, 0) };
}

export async function addItem(customerId: number, productId: number, quantity = 1): Promise<CartView> {
  if (quantity <= 0) throw new CommerceError("NOT_FOUND", "수량은 1 이상이어야 합니다.");
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new CommerceError("NOT_FOUND", "상품을 찾을 수 없습니다.", { productId });
  if (!product.isActive) throw new CommerceError("INACTIVE", "판매하지 않는 상품입니다.", { productId });
  const cart = await getOrCreateCart(customerId);
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId } },
    create: { cartId: cart.id, productId, quantity },
    update: { quantity: { increment: quantity } },
  });
  return getCart(customerId);
}

export async function setQuantity(customerId: number, productId: number, quantity: number): Promise<CartView> {
  const cart = await getOrCreateCart(customerId);
  if (quantity <= 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  } else {
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      create: { cartId: cart.id, productId, quantity },
      update: { quantity },
    });
  }
  return getCart(customerId);
}

export async function removeItem(customerId: number, productId: number): Promise<CartView> {
  const cart = await getOrCreateCart(customerId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  return getCart(customerId);
}

export async function clearCart(customerId: number): Promise<void> {
  const cart = await prisma.cart.findUnique({ where: { customerId } });
  if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
}
```

- [ ] **Step 4: 통과 확인** — `cd web && npm test -- cart` → 5 passed.
- [ ] **Step 5: 커밋** — `feat(commerce): CommerceError + 서버 장바구니 lib(cart.ts)`

---

### Task 3: `lib/orders.ts` — placeOrder/cancelOrder/배송비

**Files:** Create `web/src/lib/orders.ts`; Test `web/tests/orders.test.ts`

**Interfaces (consumes** `CommerceError`, `lib/cart` 시드 패턴**; produces):** `SHIPPING_FEE`, `FREE_SHIPPING_OVER`, `computeShipping(subtotal)`, `generateOrderNumber(now?)`, `ShippingInput`, `placeOrder(customerId, shipping)`, `getOrder(id, customerId)`, `cancelOrder(id, customerId)`.

- [ ] **Step 1: 실패 테스트** — `web/tests/orders.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { addItem } from "@/lib/cart";
import { computeShipping, placeOrder, cancelOrder, getOrder, SHIPPING_FEE } from "@/lib/orders";

let cheapId: number; // 20000
let pricyId: number; // 60000
let lowStockId: number; // stock 1

async function seed() {
  const ph = await prisma.pharmacist.create({ data: { name: "약사", email: `p${Date.now()}${Math.random()}@x.com` } });
  cheapId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "저가", price: 20000, stock: 10, isActive: true } })).id;
  pricyId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "고가", price: 60000, stock: 10, isActive: true } })).id;
  lowStockId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "재고1", price: 10000, stock: 1, isActive: true } })).id;
}

const SHIP = { recipient: "홍길동", phone: "010-1234-5678", address: "서울시 강남구" };

beforeEach(async () => {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await seed();
});

describe("computeShipping", () => {
  it("임계 미만은 배송비, 이상은 무료, 0은 0", () => {
    expect(computeShipping(20000)).toBe(SHIPPING_FEE);
    expect(computeShipping(50000)).toBe(0);
    expect(computeShipping(60000)).toBe(0);
    expect(computeShipping(0)).toBe(0);
  });
});

describe("placeOrder", () => {
  it("정상: 주문+항목 생성, 재고 차감, 장바구니 비움, 합계/배송비", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-1`);
    await addItem(c, cheapId, 2); // 40000 → 배송비 3000
    const order = await placeOrder(c, SHIP);
    expect(order.status).toBe("pending");
    expect(order.subtotal).toBe(40000);
    expect(order.shippingFee).toBe(SHIPPING_FEE);
    expect(order.total).toBe(43000);
    expect(order.items[0].unitPrice).toBe(20000);
    expect(order.items[0].lineTotal).toBe(40000);
    expect((await prisma.product.findUnique({ where: { id: cheapId } }))!.stock).toBe(8);
    expect((await prisma.cart.findUnique({ where: { customerId: c }, include: { items: true } }))!.items).toHaveLength(0);
  });

  it("무료배송: subtotal>=50000", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-2`);
    await addItem(c, pricyId, 1); // 60000
    const order = await placeOrder(c, SHIP);
    expect(order.shippingFee).toBe(0);
    expect(order.total).toBe(60000);
  });

  it("빈 장바구니: EMPTY_CART", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-3`);
    await expect(placeOrder(c, SHIP)).rejects.toMatchObject({ code: "EMPTY_CART" });
  });

  it("재고 부족: OUT_OF_STOCK, 어떤 상품도 차감 안 됨, 장바구니 유지", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-4`);
    await addItem(c, cheapId, 1);
    await addItem(c, lowStockId, 2); // stock 1 < 2
    await expect(placeOrder(c, SHIP)).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    expect((await prisma.product.findUnique({ where: { id: cheapId } }))!.stock).toBe(10); // 롤백
    expect((await prisma.product.findUnique({ where: { id: lowStockId } }))!.stock).toBe(1);
    expect((await prisma.cart.findUnique({ where: { customerId: c }, include: { items: true } }))!.items).toHaveLength(2);
  });
});

describe("cancelOrder", () => {
  it("pending 취소: 상태 cancelled + 재고 복원", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-5`);
    await addItem(c, cheapId, 2);
    const order = await placeOrder(c, SHIP);
    const cancelled = await cancelOrder(order.id, c);
    expect(cancelled.status).toBe("cancelled");
    expect((await prisma.product.findUnique({ where: { id: cheapId } }))!.stock).toBe(10);
  });

  it("남의 주문/없는 주문은 NOT_FOUND", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-6`);
    await expect(cancelOrder(999999, c)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("이미 cancelled면 INVALID_TRANSITION", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-7`);
    await addItem(c, cheapId, 1);
    const order = await placeOrder(c, SHIP);
    await cancelOrder(order.id, c);
    await expect(cancelOrder(order.id, c)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("getOrder: 소유자만", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-8`);
    await addItem(c, cheapId, 1);
    const order = await placeOrder(c, SHIP);
    expect(await getOrder(order.id, c)).not.toBeNull();
    const other = await resolveCustomer(`o-${Date.now()}-9`);
    expect(await getOrder(order.id, other)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd web && npm test -- orders` → 모듈 없음.

- [ ] **Step 3: 구현** — `web/src/lib/orders.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { CommerceError } from "@/lib/commerceErrors";

export const SHIPPING_FEE = 3000;
export const FREE_SHIPPING_OVER = 50000;

export function computeShipping(subtotal: number): number {
  if (subtotal <= 0) return 0;
  return subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE;
}

export type ShippingInput = {
  recipient: string; phone: string; address: string;
  addressDetail?: string; zipcode?: string; memo?: string;
};

export function generateOrderNumber(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return `ORD-${y}${m}${d}-${rand}`;
}

export async function placeOrder(customerId: number, shipping: ShippingInput) {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { customerId },
      include: { items: { include: { product: true }, orderBy: { id: "asc" } } },
    });
    const items = cart?.items ?? [];
    if (items.length === 0) throw new CommerceError("EMPTY_CART", "장바구니가 비어 있습니다.");

    const inactive = items.find((it) => !it.product.isActive);
    if (inactive) throw new CommerceError("INACTIVE", "판매하지 않는 상품이 포함되어 있습니다.", { productId: inactive.productId });

    for (const it of items) {
      const res = await tx.product.updateMany({
        where: { id: it.productId, stock: { gte: it.quantity } },
        data: { stock: { decrement: it.quantity } },
      });
      if (res.count === 0) throw new CommerceError("OUT_OF_STOCK", "재고가 부족합니다.", { productId: it.productId, name: it.product.name });
    }

    const subtotal = items.reduce((s, it) => s + it.product.price * it.quantity, 0);
    const shippingFee = computeShipping(subtotal);
    const total = subtotal + shippingFee;

    const order = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId,
        status: "pending",
        subtotal, shippingFee, discount: 0, total,
        recipient: shipping.recipient, phone: shipping.phone, address: shipping.address,
        addressDetail: shipping.addressDetail, zipcode: shipping.zipcode, memo: shipping.memo,
        items: {
          create: items.map((it) => ({
            productId: it.productId, productName: it.product.name,
            unitPrice: it.product.price, quantity: it.quantity, lineTotal: it.product.price * it.quantity,
          })),
        },
      },
      include: { items: true },
    });

    await tx.cartItem.deleteMany({ where: { cartId: cart!.id } });
    return order;
  });
}

export async function getOrder(id: number, customerId: number) {
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order || order.customerId !== customerId) return null;
  return order;
}

export async function cancelOrder(id: number, customerId: number) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
    if (!order || order.customerId !== customerId) throw new CommerceError("NOT_FOUND", "주문을 찾을 수 없습니다.");
    if (!["pending", "paid"].includes(order.status)) {
      throw new CommerceError("INVALID_TRANSITION", `취소할 수 없는 상태입니다: ${order.status}`);
    }
    for (const it of order.items) {
      await tx.product.update({ where: { id: it.productId }, data: { stock: { increment: it.quantity } } });
    }
    return tx.order.update({ where: { id }, data: { status: "cancelled" }, include: { items: true } });
  });
}
```

- [ ] **Step 4: 통과 확인** — `cd web && npm test -- orders` → 모든 테스트 통과.
- [ ] **Step 5: 커밋** — `feat(commerce): 주문/재고 lib(orders.ts) — placeOrder·cancelOrder·배송비`

---

### Task 4: `/api/cart` 라우트

**Files:** Create `web/src/app/api/cart/route.ts`; Test `web/tests/cart-api.test.ts`

**Interfaces (consumes** `lib/cart`, `lib/commerceErrors`, `resolveCustomer`**):** `GET/POST/PATCH/DELETE`.

- [ ] **Step 1: 실패 테스트** — `web/tests/cart-api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET, POST, PATCH, DELETE } from "@/app/api/cart/route";

let productId: number;
const SID = `cart-api-${Date.now()}`;

beforeEach(async () => {
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  const ph = await prisma.pharmacist.create({ data: { name: "약사", email: `p${Date.now()}${Math.random()}@x.com` } });
  productId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "비타민C", price: 12000, stock: 10, isActive: true } })).id;
});

const body = (b: unknown, method: string) =>
  new NextRequest("http://localhost/api/cart", { method, body: JSON.stringify(b), headers: { "Content-Type": "application/json" } });

describe("/api/cart", () => {
  it("POST 추가 → GET 조회 → PATCH 수량 → DELETE 제거", async () => {
    const add = await POST(body({ session_id: SID, productId, quantity: 2 }, "POST"));
    expect(add.status).toBe(200);
    expect((await add.json()).subtotal).toBe(24000);

    const got = await GET(new NextRequest(`http://localhost/api/cart?session_id=${SID}`));
    expect((await got.json()).items[0].quantity).toBe(2);

    const patched = await PATCH(body({ session_id: SID, productId, quantity: 5 }, "PATCH"));
    expect((await patched.json()).items[0].quantity).toBe(5);

    const del = await DELETE(body({ session_id: SID, productId }, "DELETE"));
    expect((await del.json()).items).toHaveLength(0);
  });

  it("GET: session_id 없으면 400", async () => {
    expect((await GET(new NextRequest("http://localhost/api/cart"))).status).toBe(400);
  });

  it("POST: 없는 상품 404", async () => {
    const res = await POST(body({ session_id: SID, productId: 999999, quantity: 1 }, "POST"));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd web && npm test -- cart-api` → 라우트 없음.

- [ ] **Step 3: 구현** — `web/src/app/api/cart/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveCustomer } from "@/lib/customers";
import { getCart, addItem, setQuantity, removeItem, clearCart } from "@/lib/cart";
import { CommerceError, commerceStatus } from "@/lib/commerceErrors";

function fail(e: unknown) {
  if (e instanceof CommerceError) {
    return NextResponse.json({ error: e.message, code: e.code, detail: e.detail }, { status: commerceStatus(e.code) });
  }
  return NextResponse.json({ error: "요청 처리 중 오류가 발생했습니다." }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("session_id");
  if (!sid) return NextResponse.json({ error: "session_id 필요" }, { status: 400 });
  const customerId = await resolveCustomer(sid);
  return NextResponse.json(await getCart(customerId));
}

const addSchema = z.object({ session_id: z.string().min(1), productId: z.number().int(), quantity: z.number().int().positive().default(1) });
export async function POST(req: NextRequest) {
  const p = addSchema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  try {
    const customerId = await resolveCustomer(p.data.session_id);
    return NextResponse.json(await addItem(customerId, p.data.productId, p.data.quantity));
  } catch (e) { return fail(e); }
}

const patchSchema = z.object({ session_id: z.string().min(1), productId: z.number().int(), quantity: z.number().int() });
export async function PATCH(req: NextRequest) {
  const p = patchSchema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  try {
    const customerId = await resolveCustomer(p.data.session_id);
    return NextResponse.json(await setQuantity(customerId, p.data.productId, p.data.quantity));
  } catch (e) { return fail(e); }
}

const delSchema = z.object({ session_id: z.string().min(1), productId: z.number().int().optional() });
export async function DELETE(req: NextRequest) {
  const p = delSchema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  const customerId = await resolveCustomer(p.data.session_id);
  if (p.data.productId) return NextResponse.json(await removeItem(customerId, p.data.productId));
  await clearCart(customerId);
  return NextResponse.json(await getCart(customerId));
}
```

- [ ] **Step 4: 통과 확인** — `cd web && npm test -- cart-api` → 통과.
- [ ] **Step 5: 커밋** — `feat(commerce): /api/cart 라우트(GET/POST/PATCH/DELETE)`

---

### Task 5: `/api/orders` 체크아웃 + 상세 + 취소

**Files:** Modify `web/src/app/api/orders/route.ts`(스텁 대체); Create `web/src/app/api/orders/[id]/route.ts`, `web/src/app/api/orders/[id]/cancel/route.ts`; Test `web/tests/orders-api.test.ts`

**Interfaces (consumes** `lib/orders`, `resolveCustomer`**):** `POST /api/orders`(체크아웃), `GET /api/orders/[id]`, `POST /api/orders/[id]/cancel`.

- [ ] **Step 1: 실패 테스트** — `web/tests/orders-api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { addItem } from "@/lib/cart";
import { POST as checkout } from "@/app/api/orders/route";
import { GET as getOrder } from "@/app/api/orders/[id]/route";
import { POST as cancel } from "@/app/api/orders/[id]/cancel/route";

let productId: number;
const SID = `orders-api-${Date.now()}`;
const SHIP = { recipient: "홍길동", phone: "010-1234-5678", address: "서울시" };

beforeEach(async () => {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  const ph = await prisma.pharmacist.create({ data: { name: "약사", email: `p${Date.now()}${Math.random()}@x.com` } });
  productId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "비타민C", price: 12000, stock: 5, isActive: true } })).id;
});

const post = (url: string, b: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(b), headers: { "Content-Type": "application/json" } });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("/api/orders", () => {
  it("체크아웃 201 → 상세 → 취소", async () => {
    const c = await resolveCustomer(SID);
    await addItem(c, productId, 2);
    const res = await checkout(post("http://localhost/api/orders", { session_id: SID, shipping: SHIP }));
    expect(res.status).toBe(201);
    const order = await res.json();
    expect(order.total).toBe(24000 + 3000);

    const got = await getOrder(new NextRequest(`http://localhost/api/orders/${order.id}?session_id=${SID}`), ctx(order.id));
    expect((await got.json()).orderNumber).toBe(order.orderNumber);

    const cancelled = await cancel(post(`http://localhost/api/orders/${order.id}/cancel`, { session_id: SID }), ctx(order.id));
    expect((await cancelled.json()).status).toBe("cancelled");
    expect((await prisma.product.findUnique({ where: { id: productId } }))!.stock).toBe(5);
  });

  it("빈 장바구니 체크아웃 400", async () => {
    const res = await checkout(post("http://localhost/api/orders", { session_id: `empty-${Date.now()}`, shipping: SHIP }));
    expect(res.status).toBe(400);
  });

  it("배송지 누락 400", async () => {
    const c = await resolveCustomer(`bad-${Date.now()}`);
    await addItem(c, productId, 1);
    const res = await checkout(post("http://localhost/api/orders", { session_id: `bad2-${Date.now()}`, shipping: { recipient: "x" } }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd web && npm test -- orders-api` → 라우트 없음.

- [ ] **Step 3: 구현** — `web/src/app/api/orders/route.ts`(스텁 대체):

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveCustomer } from "@/lib/customers";
import { placeOrder } from "@/lib/orders";
import { CommerceError, commerceStatus } from "@/lib/commerceErrors";

const shippingSchema = z.object({
  recipient: z.string().min(1), phone: z.string().min(1), address: z.string().min(1),
  addressDetail: z.string().optional(), zipcode: z.string().optional(), memo: z.string().optional(),
});
const checkoutSchema = z.object({ session_id: z.string().min(1), shipping: shippingSchema });

export async function POST(req: NextRequest) {
  const p = checkoutSchema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  try {
    const customerId = await resolveCustomer(p.data.session_id);
    const order = await placeOrder(customerId, p.data.shipping);
    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    if (e instanceof CommerceError) return NextResponse.json({ error: e.message, code: e.code, detail: e.detail }, { status: commerceStatus(e.code) });
    return NextResponse.json({ error: "주문 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
```
  `web/src/app/api/orders/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { resolveCustomer } from "@/lib/customers";
import { getOrder } from "@/lib/orders";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sid = req.nextUrl.searchParams.get("session_id");
  if (!sid) return NextResponse.json({ error: "session_id 필요" }, { status: 400 });
  const customerId = await resolveCustomer(sid);
  const order = await getOrder(Number(id), customerId);
  if (!order) return NextResponse.json({ error: "주문을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(order);
}
```
  `web/src/app/api/orders/[id]/cancel/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveCustomer } from "@/lib/customers";
import { cancelOrder } from "@/lib/orders";
import { CommerceError, commerceStatus } from "@/lib/commerceErrors";

const schema = z.object({ session_id: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = schema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  try {
    const customerId = await resolveCustomer(p.data.session_id);
    return NextResponse.json(await cancelOrder(Number(id), customerId));
  } catch (e) {
    if (e instanceof CommerceError) return NextResponse.json({ error: e.message, code: e.code, detail: e.detail }, { status: commerceStatus(e.code) });
    return NextResponse.json({ error: "주문 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 4: 통과 확인** — `cd web && npm test -- orders-api` 통과. 그리고 전체 `npm test` 그린.
- [ ] **Step 5: 커밋** — `feat(commerce): /api/orders 체크아웃 + 상세 + 취소`

---

### Task 6: 클라 session 헬퍼 + StoreProvider 장바구니 상태

**Files:** Create `web/src/lib/session.ts`; Modify `web/src/components/store/ChatPanel.tsx`(헬퍼 사용), `web/src/components/store/StoreProvider.tsx`(장바구니 상태/액션)

**Interfaces (produces):** `getSessionId()`; 스토어에 `cart: CartView|null`·`cartCount`·`cartOpen`·`setCartOpen`·`addToCart(productId)`·`updateQty(productId,q)`·`removeFromCart(productId)`·`refreshCart()`·`checkout(shipping): Promise<{ok:boolean, order?:any, error?:string}>`.

- [ ] **Step 1: session 헬퍼** — `web/src/lib/session.ts`:

```ts
export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("pham_session_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("pham_session_id", id);
  }
  return id;
}
```

- [ ] **Step 2: ChatPanel 리팩터** — `web/src/components/store/ChatPanel.tsx`에서 인라인 `sessionId` 생성 블록(약 line 17-23)을 제거하고 `import { getSessionId } from "@/lib/session";` 후 사용처(`session_id: sessionId.current`)를 `session_id: getSessionId()`로 바꾼다. 동작 동일(같은 localStorage 키).

- [ ] **Step 3: StoreProvider 장바구니** — `web/src/components/store/StoreProvider.tsx`:
  - import: `import { getSessionId } from "@/lib/session";` 및 `CartView` 타입(인라인 정의 또는 `import type { CartView } from "@/lib/cart"` — 단, lib/cart는 서버 전용 prisma를 import하므로 클라 번들에 들어가지 않게 **타입만** `import type`로 가져오거나 인라인 타입 선언). **인라인 타입 권장**:
    ```ts
    type CartItemView = { productId: number; name: string; price: number; quantity: number; lineTotal: number; isActive: boolean; stock: number };
    type CartView = { items: CartItemView[]; subtotal: number };
    ```
  - 상태: `const [cart, setCart] = useState<CartView | null>(null);` `const [cartOpen, setCartOpen] = useState(false);`
  - 액션(모두 서버 호출 후 `setCart`):
    ```ts
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
    ```
  - mount 시 `useEffect(() => { void refreshCart(); }, [refreshCart]);`
  - `cartCount = cart?.items.reduce((s, it) => s + it.quantity, 0) ?? 0;`
  - 위 값/함수를 `value`에 추가하고 `StoreState` 타입에 선언.

- [ ] **Step 4: 검증** — `cd web && npx tsc --noEmit` clean, `npm test` 그린(기존 테스트 영향 없음 — 특히 chat 흐름).
- [ ] **Step 5: 커밋** — `feat(web): getSessionId 헬퍼 + 스토어 장바구니 상태/액션`

---

### Task 7: ProductCard "담기" → addToCart + 장바구니 배지

**Files:** Modify `web/src/components/ProductCard.tsx`, `web/src/components/store/Storefront.tsx`(또는 `Shell.tsx` — 장바구니 버튼/배지 위치)

- [ ] **Step 1: ProductCard** — `buy()`의 `fetch("/api/orders", …)` 직접 호출을 스토어 `addToCart(p.id)`로 교체. `import { useStore } from "@/components/store/StoreProvider";` 후 `const { addToCart } = useStore();`. 버튼 라벨 "담기" 유지, 클릭 시 `await addToCart(p.id)` + 짧은 "담김" 피드백.
- [ ] **Step 2: 장바구니 버튼/배지** — `Storefront.tsx`(상품 패널 헤더) 또는 `Shell.tsx`에 장바구니 아이콘 버튼 추가: `const { cartCount, setCartOpen } = useStore();` 클릭 시 `setCartOpen(true)`, `cartCount>0`이면 숫자 배지. 스타일은 기존 `.spark`/슬레이트 톤과 일관.
- [ ] **Step 3: 검증** — `cd web && npx tsc --noEmit` clean, `npm test` 그린.
- [ ] **Step 4: 커밋** — `feat(web): 담기→장바구니 + 장바구니 개수 배지`

---

### Task 8: CartPanel(슬라이드오버) + CheckoutForm + 주문 확인

**Files:** Create `web/src/components/store/CartPanel.tsx`, `web/src/components/store/CheckoutForm.tsx`; Modify `web/src/components/store/Shell.tsx`(CartPanel 마운트)

- [ ] **Step 1: CartPanel** — `web/src/components/store/CartPanel.tsx`: `useStore()`의 `cart`·`cartOpen`·`setCartOpen`·`updateQty`·`removeFromCart` 사용. 슬라이드오버(우측 고정 패널, `cartOpen`일 때): 항목 목록(이름·단가·수량 스테퍼[+/-, `updateQty`]·삭제[`removeFromCart`]·lineTotal), 합계(subtotal·배송비 안내·총액), 비활성 상품 배지. 하단 "주문하기" → 내부 상태로 CheckoutForm 표시. 빈 장바구니면 안내 문구. 배송비는 클라에서 `subtotal>=50000?0:3000`로 표시(서버가 최종 확정).
- [ ] **Step 2: CheckoutForm** — `web/src/components/store/CheckoutForm.tsx`: `Modal`(또는 패널 내 폼) 재사용. 입력: 수령인·연락처·주소·상세주소·우편번호·메모. 제출 시 `const res = await checkout({ recipient, phone, address, addressDetail, zipcode, memo });` 성공이면 **주문 확인 화면**(주문번호·총액·상태 `pending`·"결제는 준비 중입니다(다음 단계)") + 장바구니 닫기; 실패면 인라인 에러(`res.error`, 재고부족이면 `res.detail.name` 명시).
- [ ] **Step 3: Shell 마운트** — `web/src/components/store/Shell.tsx`에 `<CartPanel />` 추가(전역 1개).
- [ ] **Step 4: 검증** — `cd web && npx tsc --noEmit` clean, `npm test` 그린. (UI 동작은 라이브 스모크에서 확인 — Task 9.)
- [ ] **Step 5: 커밋** — `feat(web): 장바구니 패널 + 체크아웃 폼 + 주문 확인`

---

### Task 9: 라이브 스모크 + 문서

**Files:** Modify `docs/ROADMAP.md`, `README.md`

- [ ] **Step 1: 라이브 스모크**(키/web 준비 환경에서만) — `make start` 후 스토어프론트에서 상품 "담기" → 장바구니 패널에서 수량 조절 → 주문하기 → 배송지 입력 → 주문 확인(주문번호·pending). 재고 차감 확인(`/admin` 상품 재고 감소). 재고보다 많은 수량 주문 시 재고부족 안내. 미가용 환경이면 건너뛰고 보고.
- [ ] **Step 2: ROADMAP** — `docs/ROADMAP.md` E2 항목 체크:
  - `#### E2. 장바구니·주문`의 4개 `- [ ]`를 `- [x]`로(장바구니 다중상품, Order 확장/OrderItem·가격 스냅샷, 상태 머신[pending~cancelled], 재고 차감·복원·오버셀 방지). 배송지 스냅샷 포함, 결제정보 컬럼은 E1로 남김을 한 줄 명기.
- [ ] **Step 3: README** — "주요 기능"에 장바구니·주문(재고 차감) 한 줄, "프로토타입 범위"에 "결제는 E1 예정(주문은 pending까지)" 반영.
- [ ] **Step 4: 커밋** — `docs(commerce): E2 장바구니·주문·재고 완료 반영`

---

## Self-Review

**Spec coverage:**
- Cart/CartItem 서버 영속 → Task 1·2 ✅
- Order 재설계 + OrderItem(가격 스냅샷) → Task 1·3 ✅
- 트랜잭션 조건부 재고 차감/오버셀 방지 → Task 3 placeOrder ✅
- 배송비 상수/무료 임계 → Task 3 computeShipping ✅
- 상태 머신 pending·cancelled + 재고 복원 → Task 3 cancelOrder ✅
- /api/cart·/api/orders(체크아웃·상세·취소) → Task 4·5 ✅
- resolveCustomer 연결 + 에러 비노출 → Task 4·5 ✅
- session 공유·스토어·담기·카트 UI·체크아웃·확인 → Task 6·7·8 ✅
- 문서 → Task 9 ✅

**Placeholder scan:** 모든 코드 스텝에 실제 코드. UI 태스크(7·8)는 컴포넌트 코드+통합지점 명시, RTL 하니스 부재로 tsc+라이브 스모크 검증(기존 UI 태스크 관례와 동일).

**Type consistency:** `CartView`(items/subtotal)·`CommerceError.code`·`ShippingInput`·`placeOrder/cancelOrder/getOrder` 시그니처가 lib→API→store에서 일치. `commerceStatus` 코드 매핑(NOT_FOUND 404·OUT_OF_STOCK/INVALID_TRANSITION 409·그 외 400)이 테스트 기대와 일치.
