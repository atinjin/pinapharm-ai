import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { addItem } from "@/lib/cart";
import { placeOrder } from "@/lib/orders";
import {
  computeShipping,
  isRemoteArea,
  trackingUrl,
  markShipped,
  markDelivered,
  listOrders,
  getOrderAdmin,
  SHIPPING_FEE,
  FREE_SHIPPING_OVER,
  REMOTE_AREA_FEE,
} from "@/lib/orders";

let productId: number;
const SHIP = { recipient: "홍길동", phone: "010-0000-0000", address: "서울시 강남구" };
const SHIP_JEJU = { ...SHIP, zipcode: "63001" };

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

// ─── computeShipping ───────────────────────────────────────────────
describe("computeShipping", () => {
  it("기본 배송비", () => {
    expect(computeShipping(10000)).toBe(SHIPPING_FEE);
  });

  it("무료 배송 임계 이상", () => {
    expect(computeShipping(FREE_SHIPPING_OVER)).toBe(0);
  });

  it("subtotal 0이면 0", () => {
    expect(computeShipping(0)).toBe(0);
  });

  it("일반 지역 + zipcode 무시", () => {
    expect(computeShipping(10000, "06234")).toBe(SHIPPING_FEE);
  });

  it("도서산간(제주) 기본 + 추가비", () => {
    expect(computeShipping(10000, "63001")).toBe(SHIPPING_FEE + REMOTE_AREA_FEE);
  });

  it("무료 임계 이상 + 도서산간 → 도서산간비만", () => {
    expect(computeShipping(FREE_SHIPPING_OVER, "63999")).toBe(REMOTE_AREA_FEE);
  });

  it("도서산간이지만 subtotal 0 → 0", () => {
    expect(computeShipping(0, "63001")).toBe(0);
  });
});

// ─── isRemoteArea ────────────────────────────────────────────────
describe("isRemoteArea", () => {
  it("제주 63 접두 → true", () => {
    expect(isRemoteArea("63001")).toBe(true);
    expect(isRemoteArea("63999")).toBe(true);
  });

  it("서울 06 → false", () => {
    expect(isRemoteArea("06234")).toBe(false);
  });

  it("undefined → false", () => {
    expect(isRemoteArea(undefined)).toBe(false);
  });

  it("빈 문자열 → false", () => {
    expect(isRemoteArea("")).toBe(false);
  });
});

// ─── trackingUrl ─────────────────────────────────────────────────
describe("trackingUrl", () => {
  it("CJ 딥링크에 송장번호 치환", () => {
    const url = trackingUrl("CJ", "1234567890");
    expect(url).toContain("1234567890");
    expect(url).toContain("cjlogistics.com");
  });

  it("LOTTE 딥링크", () => {
    const url = trackingUrl("LOTTE", "9999");
    expect(url).toContain("9999");
    expect(url).toContain("lotteglogis.com");
  });

  it("HANJIN 딥링크", () => {
    const url = trackingUrl("HANJIN", "1111");
    expect(url).toContain("1111");
    expect(url).toContain("hanjin.com");
  });

  it("POST 딥링크", () => {
    const url = trackingUrl("POST", "2222");
    expect(url).toContain("2222");
    expect(url).toContain("epost.go.kr");
  });

  it("LOGEN 딥링크", () => {
    const url = trackingUrl("LOGEN", "3333");
    expect(url).toContain("3333");
    expect(url).toContain("ilogen.com");
  });

  it("알 수 없는 택배사 → null", () => {
    expect(trackingUrl("UNKNOWN", "123")).toBeNull();
  });
});

// ─── markShipped / markDelivered ─────────────────────────────────
describe("markShipped", () => {
  async function paidOrder(sid: string) {
    const c = await resolveCustomer(sid);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, SHIP);
    // 결제 수동 완료(E1 없이 DB 직접)
    await prisma.order.update({ where: { id: order.id }, data: { status: "paid" } });
    return order;
  }

  it("paid → shipped, 택배사·송장·shippedAt 저장", async () => {
    const order = await paidOrder(`ship-${Date.now()}-1`);
    const shipped = await markShipped(order.id, { carrier: "CJ", trackingNumber: "1234567890" });
    expect(shipped.status).toBe("shipped");
    expect(shipped.carrier).toBe("CJ");
    expect(shipped.trackingNumber).toBe("1234567890");
    expect(shipped.shippedAt).not.toBeNull();
  });

  it("paid가 아닌 주문(pending) → INVALID_TRANSITION", async () => {
    const c = await resolveCustomer(`ship-${Date.now()}-2`);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, SHIP);
    await expect(markShipped(order.id, { carrier: "CJ", trackingNumber: "x" })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("없는 주문 → NOT_FOUND", async () => {
    await expect(markShipped(999999, { carrier: "CJ", trackingNumber: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("markDelivered", () => {
  async function shippedOrder(sid: string) {
    const c = await resolveCustomer(sid);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, SHIP);
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "shipped", carrier: "CJ", trackingNumber: "123", shippedAt: new Date() },
    });
    return order;
  }

  it("shipped → delivered, deliveredAt 저장", async () => {
    const order = await shippedOrder(`dlv-${Date.now()}-1`);
    const delivered = await markDelivered(order.id);
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAt).not.toBeNull();
  });

  it("shipped 아닌 주문(paid) → INVALID_TRANSITION", async () => {
    const c = await resolveCustomer(`dlv-${Date.now()}-2`);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, SHIP);
    await prisma.order.update({ where: { id: order.id }, data: { status: "paid" } });
    await expect(markDelivered(order.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

// ─── listOrders ──────────────────────────────────────────────────
describe("listOrders", () => {
  async function makeOrder(sid: string, status = "pending") {
    const c = await resolveCustomer(sid);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, { recipient: `수령인${sid.slice(-4)}`, phone: "010", address: "서울" });
    if (status !== "pending") await prisma.order.update({ where: { id: order.id }, data: { status } });
    return order;
  }

  it("전체 목록 반환", async () => {
    await makeOrder(`lst-${Date.now()}-1`);
    await makeOrder(`lst-${Date.now()}-2`, "paid");
    const { rows, total } = await listOrders({ skip: 0, take: 20 });
    expect(total).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("status 필터", async () => {
    await makeOrder(`lst-${Date.now()}-3`);
    await makeOrder(`lst-${Date.now()}-4`, "paid");
    const { rows } = await listOrders({ status: "paid", skip: 0, take: 20 });
    expect(rows.every((r) => r.status === "paid")).toBe(true);
  });

  it("q로 주문번호 검색", async () => {
    const order = await makeOrder(`lst-${Date.now()}-5`);
    const { rows } = await listOrders({ q: order.orderNumber.slice(4, 12), skip: 0, take: 20 });
    expect(rows.some((r) => r.id === order.id)).toBe(true);
  });

  it("페이징", async () => {
    await makeOrder(`lst-${Date.now()}-6`);
    await makeOrder(`lst-${Date.now()}-7`);
    const { rows } = await listOrders({ skip: 0, take: 1 });
    expect(rows.length).toBe(1);
  });
});

// ─── placeOrder + 도서산간 배송비 확정 ───────────────────────────
describe("placeOrder + zipcode", () => {
  it("제주 zipcode → shippingFee에 도서산간비 포함", async () => {
    const c = await resolveCustomer(`pz-${Date.now()}`);
    await addItem(c, productId, 1); // 18000원
    const order = await placeOrder(c, SHIP_JEJU);
    // 18000 < 50000 이므로 기본 3000 + 도서산간 3000 = 6000
    expect(order.shippingFee).toBe(SHIPPING_FEE + REMOTE_AREA_FEE);
    expect(order.total).toBe(18000 + SHIPPING_FEE + REMOTE_AREA_FEE);
  });

  it("서울 zipcode → 기본 배송비만", async () => {
    const c = await resolveCustomer(`pz2-${Date.now()}`);
    await addItem(c, productId, 1);
    const order = await placeOrder(c, { ...SHIP, zipcode: "06234" });
    expect(order.shippingFee).toBe(SHIPPING_FEE);
  });
});
