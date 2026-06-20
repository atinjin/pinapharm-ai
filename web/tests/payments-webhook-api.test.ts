import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

vi.mock("@/lib/payments", async (orig) => {
  const actual = await orig<typeof import("@/lib/payments")>();
  return { ...actual, tossGetPayment: vi.fn(async (pk: string) => ({ paymentKey: pk, orderId: "x", status: "DONE", totalAmount: 21000, method: "카드" })) };
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
