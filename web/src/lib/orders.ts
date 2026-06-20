import { prisma } from "@/lib/prisma";
import { CommerceError } from "@/lib/commerceErrors";

export const SHIPPING_FEE = 3000;
export const FREE_SHIPPING_OVER = 50000;

export function computeShipping(subtotal: number): number {
  if (subtotal <= 0) return 0;
  return subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE;
}

export type ShippingInput = {
  recipient: string; phone: string; address: string;
  addressDetail?: string; zipcode?: string; memo?: string;
};

export function generateOrderNumber(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return `ORD-${y}${m}${d}-${rand}`;
}

export async function placeOrder(customerId: number, shipping: ShippingInput) {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { customerId },
      include: { items: { include: { product: true }, orderBy: { id: "asc" } } },
    });
    const items = cart?.items ?? [];
    if (items.length === 0) throw new CommerceError("EMPTY_CART", "장바구니가 비어 있습니다.");

    const inactive = items.find((it) => !it.product.isActive);
    if (inactive) throw new CommerceError("INACTIVE", "판매하지 않는 상품이 포함되어 있습니다.", { productId: inactive.productId });

    for (const it of items) {
      const res = await tx.product.updateMany({
        where: { id: it.productId, stock: { gte: it.quantity } },
        data: { stock: { decrement: it.quantity } },
      });
      if (res.count === 0) throw new CommerceError("OUT_OF_STOCK", "재고가 부족합니다.", { productId: it.productId, name: it.product.name });
    }

    const subtotal = items.reduce((s, it) => s + it.product.price * it.quantity, 0);
    const shippingFee = computeShipping(subtotal);
    const total = subtotal + shippingFee;

    const order = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId,
        status: "pending",
        subtotal, shippingFee, discount: 0, total,
        recipient: shipping.recipient, phone: shipping.phone, address: shipping.address,
        addressDetail: shipping.addressDetail, zipcode: shipping.zipcode, memo: shipping.memo,
        items: {
          create: items.map((it) => ({
            productId: it.productId, productName: it.product.name,
            unitPrice: it.product.price, quantity: it.quantity, lineTotal: it.product.price * it.quantity,
          })),
        },
      },
      include: { items: true },
    });

    await tx.cartItem.deleteMany({ where: { cartId: cart!.id } });
    return order;
  });
}

export async function getOrder(id: number, customerId: number) {
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order || order.customerId !== customerId) return null;
  return order;
}

export async function cancelOrder(id: number, customerId: number) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
    if (!order || order.customerId !== customerId) throw new CommerceError("NOT_FOUND", "주문을 찾을 수 없습니다.");
    if (!["pending", "paid"].includes(order.status)) {
      throw new CommerceError("INVALID_TRANSITION", `취소할 수 없는 상태입니다: ${order.status}`);
    }
    for (const it of order.items) {
      await tx.product.update({ where: { id: it.productId }, data: { stock: { increment: it.quantity } } });
    }
    return tx.order.update({ where: { id }, data: { status: "cancelled" }, include: { items: true } });
  });
}
