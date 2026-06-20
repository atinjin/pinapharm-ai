import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET, POST, PATCH, DELETE } from "@/app/api/cart/route";

let productId: number;
const SID = `cart-api-${Date.now()}`;

beforeEach(async () => {
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  const ph = await prisma.pharmacist.create({ data: { name: "약사" } });
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
