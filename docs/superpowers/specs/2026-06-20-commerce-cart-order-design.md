# 커머스 E2 — 장바구니·주문·재고 설계

- **작성일:** 2026-06-20
- **로드맵 항목:** E. 커머스 → E2(장바구니·주문) + 재고 차감
- **다음:** E1(PG 결제)는 별도 스펙. 본 스펙은 결제 직전까지(주문 `pending`).

## 목적

현재 "담기" 버튼은 곧바로 단일 상품 주문을 기록만 한다(장바구니·고객 연결·재고 차감 없음, `Order`는 최소). 실제 판매의 토대인 **서버 영속 장바구니 → 완결형 주문(배송지 포함) → 재고 차감(오버셀 방지)** 을 구축한다. 결제(E1)·택배 추적(E3)·구매자 인증/주문내역(E4)은 범위 밖.

## 결정 사항

- **장바구니: 서버 영속**(`Cart`/`CartItem`, 고객당 1개). 새로고침·기기 간 유지.
- **E2 범위: 완결형 주문**(최소 배송지 입력 + 단순 배송비 상수). 택배사·송장·추적·실배송비 정책은 E3.
- **고객 해석**: 기존 `resolveCustomer(session_id)` 재사용(익명 Identity). ChatPanel과 동일한 `pham_session_id` 공유.
- **상태**: 주문 생성 시 `pending`(결제 대기). 실제 PG는 E1.
- **금액**: 정수 KRW(원). 부동소수 미사용. 스냅샷은 주문 시점 가격.

## 데이터 모델 (Prisma)

```prisma
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

model Order {
  id            Int         @id @default(autoincrement())
  orderNumber   String      @unique
  customer      Customer    @relation(fields: [customerId], references: [id])
  customerId    Int
  items         OrderItem[]
  status        String      @default("pending") // pending→paid→preparing→shipped→delivered / cancelled
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
  productName String  // 스냅샷
  unitPrice   Int     // 스냅샷(원)
  quantity    Int
  lineTotal   Int     // unitPrice * quantity
}
```

- 관계 추가: `Customer`에 `cart Cart?`·`orders Order[]`; `Product`에 `cartItems CartItem[]`·`orderItems OrderItem[]`.
- **마이그레이션**: 기존 `Order.productId/quantity` 단일 필드 제거. 기존 prototype Order 행은 실주문이 아니므로, 마이그레이션에서 각 행을 `OrderItem` 1건 + 신규 필드 기본값(스냅샷은 현재 product.price·name, 배송지/번호는 플레이스홀더)으로 이전하거나, 개발 데이터로 간주해 재생성. 운영 데이터 없음.

## 라이브러리 (`web/src/lib/`)

### `cart.ts`
- `getOrCreateCart(customerId): Promise<Cart>`
- `getCart(customerId): Promise<{ items: {product, quantity, lineTotal}[], subtotal }>` — product 조인. 비활성 상품도 장바구니엔 표시(배지로 알림)하되 주문 시 차단(아래 placeOrder 2단계).
- `addItem(customerId, productId, quantity=1)` — 상품 활성·존재 검증; 이미 있으면 수량 가산(`@@unique` upsert).
- `setQuantity(customerId, productId, quantity)` — quantity≤0이면 제거.
- `removeItem(customerId, productId)`, `clearCart(customerId)`.

### `orders.ts`
- 상수: `SHIPPING_FEE = 3000`, `FREE_SHIPPING_OVER = 50000`.
- `computeShipping(subtotal): number` — subtotal≥FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE (subtotal 0이면 0).
- `generateOrderNumber(): string` — `ORD-YYYYMMDD-####`(랜덤 4자리). `@unique` 충돌 시 재시도(최대 N회).
- `placeOrder(customerId, shipping): Promise<Order>` — `prisma.$transaction(async tx => …)`:
  1. 장바구니+항목+product 로드. 비어있으면 `EmptyCartError`.
  2. 활성 상품만 대상(비활성 항목 있으면 `InactiveItemError` 또는 자동 제외 — 본 스펙: **에러로 알림**).
  3. 각 항목 **조건부 재고 차감**: `tx.product.updateMany({ where: { id: productId, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } })`. `count===0`이면 `OutOfStockError(productId)` → 트랜잭션 롤백.
  4. `subtotal = Σ product.price*qty`(스냅샷), `shippingFee = computeShipping(subtotal)`, `discount=0`, `total = subtotal + shippingFee - discount`.
  5. `Order` + `OrderItem[]`(productName·unitPrice 스냅샷) 생성, status `pending`, orderNumber 부여.
  6. 장바구니 비움.
  반환: 생성된 Order(+items).
- `getOrder(idOrNumber, customerId): Promise<Order | null>` — 소유 고객만.
- `cancelOrder(orderId, customerId): Promise<Order>` — status가 `pending`/`paid`면 `cancelled`로 전이 + 재고 복원(`increment`), 트랜잭션. 그 외 상태면 `InvalidTransitionError`.

오류 타입은 명시적 클래스/판별 가능한 코드로 두어 라우트가 적절한 HTTP 상태로 매핑.

## API (`web/src/app/api/`)

- `/api/cart`
  - `GET ?session_id=` → 장바구니(items+subtotal).
  - `POST { session_id, productId, quantity? }` → addItem → 갱신된 장바구니.
  - `PATCH { session_id, productId, quantity }` → setQuantity.
  - `DELETE { session_id, productId? }` → productId 있으면 removeItem, 없으면 clearCart.
- `/api/orders`
  - `POST { session_id, shipping:{recipient, phone, address, addressDetail?, zipcode?, memo?} }` → `placeOrder`. **기존 단일주문 POST 대체.** zod 검증. 재고부족 409, 빈 장바구니 400.
  - `GET /api/orders/[id]?session_id=` → 주문 상세(소유자 확인).
  - `POST /api/orders/[id]/cancel { session_id }` → `cancelOrder`.

모든 라우트: `session_id`로 `resolveCustomer` → customerId. 내부/Prisma 에러 메시지 비노출(기존 어드민 라우트 관례).

## UI (`web/src/components/store/`)

- `lib/session.ts`(클라): `getSessionId()` — `pham_session_id` 읽기/생성. ChatPanel·StoreProvider가 공유(현재 ChatPanel 인라인 로직을 이 헬퍼로 이전).
- `StoreProvider`: `cart`(items·count·subtotal·shippingFee·total)·`cartOpen` 상태 + `addToCart`/`updateQty`/`removeFromCart`/`refreshCart`/`checkout`. 서버 동기(액션 후 GET로 갱신). 초기 로드시 장바구니 fetch.
- `ProductCard` "담기" → `addToCart(p.id)`(서버), 성공 토스트/배지. 헤더/도크에 **장바구니 개수 배지**.
- `CartPanel`(슬라이드오버): 항목 목록·수량 스테퍼·삭제·subtotal/배송비/total·"주문하기".
- `CheckoutForm`(Modal 재사용): recipient·phone·address(+addressDetail·zipcode·memo) 입력 → `checkout(shipping)` → 성공 시 **주문 확인**(주문번호·상태 pending·"결제는 준비 중(E1)" 안내). 실패 시 인라인 에러(재고부족 항목 명시).

## 에러 처리

- 담기: 상품 없음 404, 비활성 400.
- 체크아웃: 빈 장바구니 400, 재고 부족 409(어느 상품인지), 배송지 누락/형식 오류 zod 400, 비활성 상품 포함 409/400.
- 동시성: 조건부 차감(`updateMany ... stock gte`)으로 오버셀 원천 차단. 차감 실패 시 트랜잭션 롤백 → 부분 차감/부분 주문 없음.
- cancel: 허용되지 않는 상태 전이 409.

## 테스트 (vitest, route 직접 호출)

- `lib/orders`: placeOrder 정상(주문+항목 생성·재고 차감·장바구니 비움·subtotal/shippingFee/total 정확), 오버셀(재고<수량 → throw, 어떤 상품도 차감 안 됨, 장바구니 유지), 무료배송 임계(subtotal≥50000 → 배송비 0), 다중 항목 합계, cancel(상태 전이 + 재고 복원), 잘못된 전이 거부.
- `lib/cart`: add(신규/수량 가산)·setQuantity(0→제거)·remove·clear·getCart subtotal.
- API: `/api/cart`(add/patch/delete), `/api/orders` 체크아웃(정상 201·재고부족 409·빈 장바구니 400), 주문 상세(소유자), cancel.
- 금액: 정수 KRW 일관, 부동소수 없음.

## 범위 밖 (후속)

- **E1**: PG 결제(승인·취소·환불·웹훅), `pending→paid` 전이, Order 결제정보 컬럼.
- **E3**: 택배사 연동·송장·추적·실배송비 정책(지역/무게).
- **E4**: 구매자 로그인/회원가입, **주문내역 목록 UI**.
- 쿠폰/프로모션(`discount` 필드만 두고 0), 위시리스트, 재입고 알림.
