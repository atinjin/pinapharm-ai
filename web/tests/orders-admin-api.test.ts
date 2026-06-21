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
