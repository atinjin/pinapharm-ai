# 커머스 E3 — 배송 (어드민 발송 처리) 설계

- **작성일:** 2026-06-21
- **로드맵 항목:** E. 커머스 → E3(배송)
- **선행:** E2(장바구니·주문·재고) + E1(결제) 완료. 주문이 `paid`까지 도달한다.
- **후속:** E4(구매자 인증·주문내역 UI), E6(반품·CS)

## 목적

약사가 어드민에서 `paid` 주문을 확인하고 택배사·송장번호를 입력해 발송 처리(`shipped`)하며, 배송 완료(`delivered`)를 기록한다. 고객용 추적은 E4(구매자 인증) 이후로 미룬다. 도서산간 배송비를 우편번호 접두로 자동 산정한다.

## 결정 사항

- **택배 연동: 송장+딥링크** — 실 추적 API(스마트택배 등) 없음. 택배사+송장번호를 DB에 저장하고, 어드민에서 택배사별 공개 추적 URL로 딥링크.
- **고객 노출: B1(어드민 중심)** — 고객용 주문내역·추적 화면은 E4.
- **상태 머신 확장**: `paid → shipped → delivered`. 기존 `pending/cancelled/refunded` 불변. `shipped/delivered`에선 취소 불가(`INVALID_TRANSITION`).
- **도서산간**: `computeShipping(subtotal, zipcode?)` 확장. 제주·도서산간 우편번호 접두 매칭 시 추가비 +3,000원(무료 임계를 넘어도 도서산간비는 별도). 접두 목록은 근사값(프로토타입); 완전 목록은 E6 운영 개선.
- **CartPanel 미리보기**: 기본 배송비만 표시, "도서산간은 추가될 수 있음" 안내. 최종 금액은 주문 생성(서버) 시 확정.
- **어드민 탭 추가**: "주문 관리" — 지식 베이스 탭 패턴 그대로.

## 데이터 모델 (Prisma)

`Order`에 nullable 배송 컬럼 추가:

```prisma
model Order {
  // ... 기존 필드 ...
  carrier        String?   // 택배사 식별자: "CJ" | "LOTTE" | "HANJIN" | "POST" | "LOGEN" | etc.
  trackingNumber String?
  shippedAt      DateTime?
  deliveredAt    DateTime?
}
```

마이그레이션은 nullable 추가뿐, 기존 주문 행 호환.

## 배송비 정책 (`lib/orders.ts`)

```ts
export const REMOTE_AREA_FEE = 3000;

// 제주·도서산간 우편번호 접두 (프로토타입 근사 목록)
// 제주: 63xxx, 제주시 일부 64xxx
// 도서산간은 전수 목록이 복잡하므로 프로토타입에서는 제주 접두만 적용
const REMOTE_ZIP_PREFIXES = ["63"];

export function isRemoteArea(zipcode?: string): boolean {
  if (!zipcode) return false;
  return REMOTE_ZIP_PREFIXES.some((p) => zipcode.startsWith(p));
}

export function computeShipping(subtotal: number, zipcode?: string): number {
  if (subtotal <= 0) return 0;
  const base = subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE;
  const remote = isRemoteArea(zipcode) ? REMOTE_AREA_FEE : 0;
  return base + remote;
}
```

`placeOrder` 호출부를 `computeShipping(subtotal, shipping.zipcode)`로 업데이트 — 주문 생성 시 shippingFee 확정.

## 도메인 (`lib/orders.ts` 추가)

- **`trackingUrl(carrier: string, trackingNumber: string): string | null`** — 택배사별 공개 추적 URL 템플릿 맵. 없는 택배사는 `null`. 키·회원가입 불필요.

  ```ts
  const TRACKING_URLS: Record<string, string> = {
    CJ: "https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo={no}",
    LOTTE: "https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo={no}",
    HANJIN: "https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillSch.do?mCode=MN038&schLang=KOR&wblnumText2={no}",
    POST: "https://service.epost.go.kr/trace.RetrieveEmsRigiTraceList.comm?POST_CODE={no}",
    LOGEN: "https://www.ilogen.com/web/personal/trace/{no}",
  };
  // {no}를 trackingNumber로 치환
  ```

- **`markShipped(orderId: number, data: { carrier: string; trackingNumber: string }): Promise<Order>`**
  1. 주문 로드(admin 전용이라 customerId 체크 없음).
  2. `status !== "paid"` → `INVALID_TRANSITION`.
  3. `prisma.order.update({ status: "shipped", carrier, trackingNumber, shippedAt: now })`.
  4. 갱신된 Order 반환.

- **`markDelivered(orderId: number): Promise<Order>`**
  1. `status !== "shipped"` → `INVALID_TRANSITION`.
  2. `prisma.order.update({ status: "delivered", deliveredAt: now })`.

- **`listOrders({ status?, q?, skip, take }): Promise<{ rows: Order[], total: number }>`** — 어드민 전용.
  - `q`는 `orderNumber`, `recipient` 부분 일치(OR).
  - `status`는 필터(복수 미지원).
  - `include: { items: true }` (어드민에서 상품 표시).

- **`getOrderAdmin(id: number): Promise<Order | null>`** — customerId 무관.

## API (`web/src/app/api/admin/orders/`)

모두 어드민 전용, 인증 없음(로드맵 A).

- **`GET /api/admin/orders?status=&q=&page=N`** — `listOrders` 호출, `{ rows, total, page, pageSize: 20 }`.
- **`GET /api/admin/orders/[id]`** — `getOrderAdmin`.
- **`POST /api/admin/orders/[id]/ship`** — `{ carrier, trackingNumber }` zod 검증 → `markShipped`.
- **`POST /api/admin/orders/[id]/deliver`** — body 없음 → `markDelivered`.

## 어드민 UI

### AdminNav (`web/src/components/AdminNav.tsx`)

TABS 배열에 `{ href: "/admin/orders", label: "주문 관리" }` 추가.

### `/admin/orders/page.tsx` (client component)

지식 베이스 탭 패턴:
- 상태: `status` 필터(전체/paid/shipped/delivered/cancelled/refunded), 검색 `q`, `page`.
- `useCallback(load)` → `GET /api/admin/orders`.
- 페이징: prev/next + "N건 / 전체 M건".
- 행: `AdminOrderItem` 컴포넌트.

### `AdminOrderItem.tsx`

- 요약 행: 주문번호·수령인·총액·상태 배지(색상 구분)·결제일·zipcode(도서산간 배지).
- 펼치기: OrderItem 목록(상품명·단가·수량) + 배송지(address·phone·memo).
- 액션:
  - `paid` 상태: "송장 입력" 버튼 → 인라인 폼 또는 모달(택배사 select + 송장번호 input → POST ship).
  - `shipped` 상태: 추적 딥링크(trackingUrl) + "배송완료" 버튼(→ POST deliver).
  - `delivered` 상태: 추적 딥링크만.

### CartPanel (`web/src/components/store/CartPanel.tsx`)

배송비 미리보기 줄 아래 소문자 주석 추가: "* 제주·도서산간 지역은 추가 배송비가 부과될 수 있습니다."  
(최종 금액은 주문 생성 시 서버에서 zipcode로 확정.)

## 에러 처리

- `markShipped`: paid 아닌 주문 → `INVALID_TRANSITION` → API 409.
- `markDelivered`: shipped 아닌 주문 → `INVALID_TRANSITION` → API 409.
- 존재하지 않는 주문 → `NOT_FOUND` → 404.
- 내부 오류 비노출(기존 admin 라우트 관례).

## 테스트 (vitest)

- **`orders.test.ts` 확장** (또는 별도 `shipping.test.ts`):
  - `computeShipping`: 기본·무료·도서산간(+3000)·무료+도서산간(+3000)·없는 zipcode.
  - `isRemoteArea`: "63" 접두 → true, "06" → false, undefined → false.
  - `markShipped`: paid→shipped 정상; non-paid→INVALID_TRANSITION; 없는 주문→NOT_FOUND.
  - `markDelivered`: shipped→delivered 정상; non-shipped→INVALID_TRANSITION.
  - `listOrders`: status 필터, q 검색, 페이징.
- **`orders-admin-api.test.ts`**: GET 목록(필터·페이징), POST ship(정상 200, 잘못된 상태 409), POST deliver.
- **`trackingUrl`**: 각 지원 택배사 URL에 trackingNumber 치환 확인, 미지원 → null.

## 범위 밖

- 실 추적 API(스마트택배/트랙킹모어) 자동 폴링/웹훅.
- 고객용 배송 추적 페이지(E4).
- 도서산간 전수 우편번호 목록(E6 운영).
- 반품/교환(E6).
- `preparing` 중간 상태(불필요한 복잡도, 생략).
- 도서산간비의 무료배송 임계 연동(예: "5만원 이상은 도서산간 제외 무료" — 현행 정책은 기본+도서산간 별도).
