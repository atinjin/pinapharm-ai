# 커머스 E1 — 토스페이먼츠 결제 설계

- **작성일:** 2026-06-20
- **로드맵 항목:** E. 커머스 → E1(결제 PG 연동)
- **선행:** E2(장바구니·주문·재고, `pending`까지) 완료. 본 스펙은 `pending → paid`와 환불·웹훅.

## 목적

주문이 재고 차감 후 `pending`에 머문다. 토스페이먼츠로 **실제 결제(테스트 키)** 를 붙여 `pending → paid`를 완성하고, 취소 시 **PG 환불**과 **웹훅 서명 검증**으로 정합을 보장한다. 핵심 안전 속성: 서버측 금액 신뢰(클라 금액 불신), confirm 멱등(이중결제 방지), 카드정보 비저장.

## 결정 사항

- **PG: 토스페이먼츠**(직접 PG, 테스트 키 즉시 동작, 명료한 server confirm).
- **키 모드: 테스트/샌드박스**. `TOSS_SECRET_KEY`(test_sk_…)·`NEXT_PUBLIC_TOSS_CLIENT_KEY`(test_ck_…)·`TOSS_WEBHOOK_SECRET`. 실 키는 환경변수 교체로 전환. 테스트 카드로 라이브 검증.
- **범위 C**: 결제창 + 서버 confirm + 취소/환불 + 웹훅 서명검증.
- **흐름**: 리다이렉트 기반(Toss 표준 successUrl/failUrl). 주문은 결제창 호출 전에 이미 `pending`으로 존재하므로 리다이렉트로 SPA 상태가 사라져도 서버 상태는 보존된다.
- **상태 머신**: `pending → paid`(confirm 성공), `paid → refunded`(PG 환불), `pending → cancelled`(미결제 취소). 모든 취소·환불은 재고 복원.

## 데이터 모델 (Prisma)

`Order`에 nullable 결제 컬럼 추가(별도 Payment 모델 없이 — 주문당 성공 결제 1건 가정):

```prisma
model Order {
  // ... 기존 필드 ...
  paymentKey    String?   // Toss paymentKey (환불에 필요)
  paymentMethod String?   // 카드/간편결제 등 (Toss 응답)
  paidAt        DateTime?
  pgProvider    String?   // 결제 성공 시 "toss"
}
```

마이그레이션은 nullable 컬럼 추가뿐이라 기존 주문 행과 호환.

## 라이브러리

### `web/src/lib/payments.ts` (Toss 클라이언트)
환경: `TOSS_SECRET_KEY`(Basic auth: `base64(secret + ":")`), `TOSS_WEBHOOK_SECRET`.

- `tossConfirm({ paymentKey, orderId, amount }): Promise<TossPayment>` — `POST https://api.tosspayments.com/v1/payments/confirm` (Basic auth), 본문 `{ paymentKey, orderId, amount }`. 비2xx면 Toss 에러코드/메시지를 담아 throw.
- `tossCancel(paymentKey, cancelReason): Promise<TossPayment>` — `POST https://api.tosspayments.com/v1/payments/{paymentKey}/cancel`, 본문 `{ cancelReason }`(전액). 비2xx throw.
- `tossGetPayment(paymentKey): Promise<TossPayment>` — `GET https://api.tosspayments.com/v1/payments/{paymentKey}` (웹훅 재조정·정합 확인).
- `verifyWebhookSignature(rawBody: string, signature: string): boolean` — `HMAC-SHA256(rawBody, TOSS_WEBHOOK_SECRET)` base64 비교(timing-safe). 헤더명·인코딩은 **현행 Toss 웹훅 문서로 확인**해 맞춘다.

`TossPayment` 타입은 사용하는 필드만(예: `status`, `method`, `approvedAt`, `totalAmount`, `orderId`, `paymentKey`).

> **구현 시 검증(필수):** confirm/cancel 엔드포인트·요청형식·웹훅 서명 헤더는 토스페이먼츠 최신 문서 기준으로 확정한다. SDK 패키지 `@tosspayments/tosspayments-sdk` 최신 사용법 확인(web/AGENTS.md "문서 먼저" 기조).

### `web/src/lib/orders.ts` 확장
- `confirmPayment(orderNumber: string, paymentKey: string, amount: number, customerId: number): Promise<Order>`:
  1. orderNumber로 주문 로드(소유 customer 확인) — 없으면 `NOT_FOUND`.
  2. **이미 `paid`면 멱등 반환**(재confirm 안 함).
  3. 상태가 `pending`이 아니면 `INVALID_TRANSITION`.
  4. **`amount !== order.total`이면 `AMOUNT_MISMATCH`**(서버 금액 신뢰).
  5. `tossConfirm({ paymentKey, orderId: orderNumber, amount })` 호출(외부, 트랜잭션 밖).
  6. 성공 시 `prisma.$transaction`으로 주문 `status="paid"`, `paymentKey`, `paymentMethod`, `paidAt`, `pgProvider="toss"` 갱신.
  - Toss confirm 실패 시 주문은 `pending` 유지(재시도 가능), 에러 전파.
- `cancelOrder(id, customerId)` **결제 인지로 확장**:
  - `pending` → `cancelled` + 재고 복원(현행, PG 호출 없음).
  - `paid` → `tossCancel(paymentKey, "고객 취소")`(외부) → 성공 시 트랜잭션으로 `status="refunded"` + 재고 복원.
  - 그 외 상태 → `INVALID_TRANSITION`.
  - 외부 PG 호출은 트랜잭션 밖에서 먼저, DB 갱신은 트랜잭션 안.

새 에러 코드: `AMOUNT_MISMATCH`(→400), `PAYMENT_FAILED`(→502). `commerceStatus`에 추가.

## API

- `POST /api/payments/confirm` — `{ session_id, paymentKey, orderId, amount }` → `resolveCustomer` → `confirmPayment` → 갱신된 주문. CommerceError·Toss 에러를 상태로 매핑.
- `POST /api/payments/webhook` — **raw body** 읽어 `verifyWebhookSignature` 실패 시 401. 성공 시 이벤트의 paymentKey/orderId로 주문 조회 → `tossGetPayment`로 결제 상태 재확인 → 주문 상태 재조정(멱등: 이미 일치하면 no-op). 세션·인증 없음(PG가 호출).
- 기존 `POST /api/orders/[id]/cancel` — `cancelOrder`가 환불까지(paid 주문은 PG 환불).

## 클라이언트

- env: `NEXT_PUBLIC_TOSS_CLIENT_KEY`. Toss SDK(`@tosspayments/tosspayments-sdk`) 로드.
- **CheckoutForm 제출 흐름 변경**: 제출 → `POST /api/orders`(주문 pending 생성, 기존 `checkout`) → 반환된 `orderNumber`·`total`로 Toss `requestPayment({ amount: total, orderId: orderNumber, orderName, successUrl: <origin>/payments/success, failUrl: <origin>/payments/fail, customerName: recipient })`. (CartPanel의 기존 "주문 완료(done)" 화면은 success 페이지로 대체.)
- `app/payments/success/page.tsx`(클라): 쿼리 `paymentKey·orderId·amount` 읽어 `POST /api/payments/confirm` → 성공 시 **결제 완료**(주문번호·총액·`paid`) 표시, 실패 시 에러.
- `app/payments/fail/page.tsx`(클라): Toss 실패 코드/메시지 표시 + 미결제 주문 취소(재고 복원) 안내·재시도 링크.

## 에러 처리·안전

- 서버측 금액 신뢰: confirm은 클라 `amount`를 받되 **DB `order.total`과 일치할 때만** Toss 승인 진행.
- 멱등: 이미 `paid`면 재confirm 금지(이중결제 방지). 웹훅도 멱등.
- 카드정보 비저장: paymentKey/method만 저장(카드번호 등 없음).
- 결제 실패/이탈: 미결제 `pending` 주문은 취소로 재고 복원(success 전까지 재고는 예약 상태).
- 내부/PG 에러 메시지 비노출(사용자엔 일반 안내, 코드/사유는 로깅).

## 테스트 (vitest, fetch 목)

- `payments.ts`: `tossConfirm`/`tossCancel`/`tossGetPayment`가 올바른 URL·Basic auth·본문으로 호출하고 응답/에러를 매핑(`vi.stubGlobal("fetch", …)`); `verifyWebhookSignature`가 알려진 HMAC에 대해 유효/무효 판정.
- `orders.confirmPayment`: 정상(pending→paid, 결제정보 저장, `tossConfirm` 목), 금액 불일치 거부(`AMOUNT_MISMATCH`, Toss 미호출), 멱등(이미 paid면 그대로), 비pending 거부.
- `orders.cancelOrder` 환불경로: paid 주문 → `tossCancel` 목 → `refunded` + 재고 복원; pending 주문 → cancelled(PG 미호출).
- API: `/api/payments/confirm`(정상·금액불일치·미존재), `/api/payments/webhook`(서명 유효→재조정·무효→401).
- 라이브 스모크: 테스트 카드로 결제창→success→paid, 어드민에서 주문 paid·재고 확인, 취소→환불→refunded·재고 복원.

## 범위 밖 (후속)

- 부분취소(전액 환불만), 정기결제·에스크로, 현금영수증/세금계산서(E6), 다중 결제수단 세분 UI, 결제 재시도 자동화, Payment 다건 이력 모델.
