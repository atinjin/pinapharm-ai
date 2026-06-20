import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";

async function seedPharmacistProduct() {
  const ph = await prisma.pharmacist.create({ data: { name: "약사" } });
  const product = await prisma.product.create({
    data: { pharmacistId: ph.id, name: "비타민C", price: 12000, stock: 5, isActive: true },
  });
  return product;
}

beforeEach(async () => {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
});

describe("commerce schema", () => {
  it("cart + cartItem 라운드트립", async () => {
    const product = await seedPharmacistProduct();
    const customer = await prisma.customer.create({ data: {} });
    const cart = await prisma.cart.create({ data: { customerId: customer.id } });
    await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, quantity: 2 } });
    const got = await prisma.cart.findUnique({ where: { customerId: customer.id }, include: { items: true } });
    expect(got!.items[0].quantity).toBe(2);
  });

  it("order + orderItem 라운드트립", async () => {
    const product = await seedPharmacistProduct();
    const customer = await prisma.customer.create({ data: {} });
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-TEST-${Date.now()}`, customerId: customer.id,
        subtotal: 24000, shippingFee: 3000, total: 27000,
        recipient: "홍길동", phone: "010-0000-0000", address: "서울시",
        items: { create: [{ productId: product.id, productName: "비타민C", unitPrice: 12000, quantity: 2, lineTotal: 24000 }] },
      },
      include: { items: true },
    });
    expect(order.status).toBe("pending");
    expect(order.items[0].lineTotal).toBe(24000);
  });
});
