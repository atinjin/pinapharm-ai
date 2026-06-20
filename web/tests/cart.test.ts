import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { getCart, addItem, setQuantity, removeItem, clearCart } from "@/lib/cart";

let productId: number;
let inactiveId: number;

beforeEach(async () => {
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  const ph = await prisma.pharmacist.create({ data: { name: "약사" } });
  productId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "오메가3", price: 20000, stock: 10, isActive: true } })).id;
  inactiveId = (await prisma.product.create({ data: { pharmacistId: ph.id, name: "비활성", price: 5000, stock: 3, isActive: false } })).id;
});

describe("cart", () => {
  it("addItem: 신규 추가 후 같은 상품은 수량 가산", async () => {
    const c = await resolveCustomer(`s-${Date.now()}-a`);
    await addItem(c, productId, 1);
    const view = await addItem(c, productId, 2);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].quantity).toBe(3);
    expect(view.items[0].lineTotal).toBe(60000);
    expect(view.subtotal).toBe(60000);
  });

  it("addItem: 비활성 상품은 INACTIVE 에러", async () => {
    const c = await resolveCustomer(`s-${Date.now()}-b`);
    await expect(addItem(c, inactiveId, 1)).rejects.toMatchObject({ code: "INACTIVE" });
  });

  it("addItem: 없는 상품은 NOT_FOUND 에러", async () => {
    const c = await resolveCustomer(`s-${Date.now()}-c`);
    await expect(addItem(c, 999999, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("setQuantity: 0이면 제거", async () => {
    const c = await resolveCustomer(`s-${Date.now()}-d`);
    await addItem(c, productId, 2);
    const view = await setQuantity(c, productId, 0);
    expect(view.items).toHaveLength(0);
    expect(view.subtotal).toBe(0);
  });

  it("removeItem / clearCart", async () => {
    const c = await resolveCustomer(`s-${Date.now()}-e`);
    await addItem(c, productId, 1);
    await removeItem(c, productId);
    expect((await getCart(c)).items).toHaveLength(0);
    await addItem(c, productId, 1);
    await clearCart(c);
    expect((await getCart(c)).items).toHaveLength(0);
  });
});
