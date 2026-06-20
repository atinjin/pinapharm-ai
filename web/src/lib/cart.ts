import { prisma } from "@/lib/prisma";
import { CommerceError } from "@/lib/commerceErrors";

export type CartView = {
  items: { productId: number; name: string; price: number; quantity: number; lineTotal: number; isActive: boolean; stock: number }[];
  subtotal: number;
};

export async function getOrCreateCart(customerId: number) {
  return prisma.cart.upsert({ where: { customerId }, create: { customerId }, update: {} });
}

export async function getCart(customerId: number): Promise<CartView> {
  const cart = await prisma.cart.findUnique({
    where: { customerId },
    include: { items: { include: { product: true }, orderBy: { id: "asc" } } },
  });
  const items = (cart?.items ?? []).map((it) => ({
    productId: it.productId, name: it.product.name, price: it.product.price,
    quantity: it.quantity, lineTotal: it.product.price * it.quantity,
    isActive: it.product.isActive, stock: it.product.stock,
  }));
  return { items, subtotal: items.reduce((s, it) => s + it.lineTotal, 0) };
}

export async function addItem(customerId: number, productId: number, quantity = 1): Promise<CartView> {
  if (quantity <= 0) throw new CommerceError("NOT_FOUND", "수량은 1 이상이어야 합니다.");
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new CommerceError("NOT_FOUND", "상품을 찾을 수 없습니다.", { productId });
  if (!product.isActive) throw new CommerceError("INACTIVE", "판매하지 않는 상품입니다.", { productId });
  const cart = await getOrCreateCart(customerId);
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId } },
    create: { cartId: cart.id, productId, quantity },
    update: { quantity: { increment: quantity } },
  });
  return getCart(customerId);
}

export async function setQuantity(customerId: number, productId: number, quantity: number): Promise<CartView> {
  const cart = await getOrCreateCart(customerId);
  if (quantity <= 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  } else {
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      create: { cartId: cart.id, productId, quantity },
      update: { quantity },
    });
  }
  return getCart(customerId);
}

export async function removeItem(customerId: number, productId: number): Promise<CartView> {
  const cart = await getOrCreateCart(customerId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  return getCart(customerId);
}

export async function clearCart(customerId: number): Promise<void> {
  const cart = await prisma.cart.findUnique({ where: { customerId } });
  if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
}
