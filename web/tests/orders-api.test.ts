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
  const ph = await prisma.pharmacist.create({ data: { name: "약사" } });
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
