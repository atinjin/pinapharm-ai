import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { addItem } from "@/lib/cart";
import { computeShipping, placeOrder, cancelOrder, getOrder, SHIPPING_FEE } from "@/lib/orders";

let cheapId: number; // 20000
let pricyId: number; // 60000
let lowStockId: number; // stock 1

async function seed() {
  const ph = await prisma.pharmacist.create({ data: { name: "약사" } });
  cheapId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "저가", price: 20000, stock: 10, isActive: true } })).id;
  pricyId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "고가", price: 60000, stock: 10, isActive: true } })).id;
  lowStockId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "재고1", price: 10000, stock: 1, isActive: true } })).id;
}

const SHIP = { recipient: "홍길동", phone: "010-1234-5678", address: "서울시 강남구" };

beforeEach(async () => {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await seed();
});

describe("computeShipping", () => {
  it("임계 미만은 배송비, 이상은 무료, 0은 0", () => {
    expect(computeShipping(20000)).toBe(SHIPPING_FEE);
    expect(computeShipping(50000)).toBe(0);
    expect(computeShipping(60000)).toBe(0);
    expect(computeShipping(0)).toBe(0);
  });
});

describe("placeOrder", () => {
  it("정상: 주문+항목 생성, 재고 차감, 장바구니 비움, 합계/배송비", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-1`);
    await addItem(c, cheapId, 2); // 40000 → 배송비 3000
    const order = await placeOrder(c, SHIP);
    expect(order.status).toBe("pending");
    expect(order.subtotal).toBe(40000);
    expect(order.shippingFee).toBe(SHIPPING_FEE);
    expect(order.total).toBe(43000);
    expect(order.items[0].unitPrice).toBe(20000);
    expect(order.items[0].lineTotal).toBe(40000);
    expect((await prisma.product.findUnique({ where: { id: cheapId } }))!.stock).toBe(8);
    expect((await prisma.cart.findUnique({ where: { customerId: c }, include: { items: true } }))!.items).toHaveLength(0);
  });

  it("무료배송: subtotal>=50000", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-2`);
    await addItem(c, pricyId, 1); // 60000
    const order = await placeOrder(c, SHIP);
    expect(order.shippingFee).toBe(0);
    expect(order.total).toBe(60000);
  });

  it("빈 장바구니: EMPTY_CART", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-3`);
    await expect(placeOrder(c, SHIP)).rejects.toMatchObject({ code: "EMPTY_CART" });
  });

  it("재고 부족: OUT_OF_STOCK, 어떤 상품도 차감 안 됨, 장바구니 유지", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-4`);
    await addItem(c, cheapId, 1);
    await addItem(c, lowStockId, 2); // stock 1 < 2
    await expect(placeOrder(c, SHIP)).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    expect((await prisma.product.findUnique({ where: { id: cheapId } }))!.stock).toBe(10); // 롤백
    expect((await prisma.product.findUnique({ where: { id: lowStockId } }))!.stock).toBe(1);
    expect((await prisma.cart.findUnique({ where: { customerId: c }, include: { items: true } }))!.items).toHaveLength(2);
  });
});

describe("cancelOrder", () => {
  it("pending 취소: 상태 cancelled + 재고 복원", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-5`);
    await addItem(c, cheapId, 2);
    const order = await placeOrder(c, SHIP);
    const cancelled = await cancelOrder(order.id, c);
    expect(cancelled.status).toBe("cancelled");
    expect((await prisma.product.findUnique({ where: { id: cheapId } }))!.stock).toBe(10);
  });

  it("남의 주문/없는 주문은 NOT_FOUND", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-6`);
    await expect(cancelOrder(999999, c)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("이미 cancelled면 INVALID_TRANSITION", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-7`);
    await addItem(c, cheapId, 1);
    const order = await placeOrder(c, SHIP);
    await cancelOrder(order.id, c);
    await expect(cancelOrder(order.id, c)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("getOrder: 소유자만", async () => {
    const c = await resolveCustomer(`o-${Date.now()}-8`);
    await addItem(c, cheapId, 1);
    const order = await placeOrder(c, SHIP);
    expect(await getOrder(order.id, c)).not.toBeNull();
    const other = await resolveCustomer(`o-${Date.now()}-9`);
    expect(await getOrder(order.id, other)).toBeNull();
  });
});
