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
