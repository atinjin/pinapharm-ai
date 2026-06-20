import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveCustomer } from "@/lib/customers";
import { getCart, addItem, setQuantity, removeItem, clearCart } from "@/lib/cart";
import { CommerceError, commerceStatus } from "@/lib/commerceErrors";

function fail(e: unknown) {
  if (e instanceof CommerceError) {
    return NextResponse.json({ error: e.message, code: e.code, detail: e.detail }, { status: commerceStatus(e.code) });
  }
  return NextResponse.json({ error: "요청 처리 중 오류가 발생했습니다." }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("session_id");
  if (!sid) return NextResponse.json({ error: "session_id 필요" }, { status: 400 });
  const customerId = await resolveCustomer(sid);
  return NextResponse.json(await getCart(customerId));
}

const addSchema = z.object({ session_id: z.string().min(1), productId: z.number().int(), quantity: z.number().int().positive().default(1) });
export async function POST(req: NextRequest) {
  const p = addSchema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  try {
    const customerId = await resolveCustomer(p.data.session_id);
    return NextResponse.json(await addItem(customerId, p.data.productId, p.data.quantity));
  } catch (e) { return fail(e); }
}

const patchSchema = z.object({ session_id: z.string().min(1), productId: z.number().int(), quantity: z.number().int() });
export async function PATCH(req: NextRequest) {
  const p = patchSchema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  try {
    const customerId = await resolveCustomer(p.data.session_id);
    return NextResponse.json(await setQuantity(customerId, p.data.productId, p.data.quantity));
  } catch (e) { return fail(e); }
}

const delSchema = z.object({ session_id: z.string().min(1), productId: z.number().int().optional() });
export async function DELETE(req: NextRequest) {
  const p = delSchema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  const customerId = await resolveCustomer(p.data.session_id);
  if (p.data.productId) return NextResponse.json(await removeItem(customerId, p.data.productId));
  await clearCart(customerId);
  return NextResponse.json(await getCart(customerId));
}
