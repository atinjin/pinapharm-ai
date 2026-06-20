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
