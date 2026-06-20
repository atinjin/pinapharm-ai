import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveCustomer } from "@/lib/customers";
import { cancelOrder } from "@/lib/orders";
import { CommerceError, commerceStatus } from "@/lib/commerceErrors";

const schema = z.object({ session_id: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = schema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  try {
    const customerId = await resolveCustomer(p.data.session_id);
    return NextResponse.json(await cancelOrder(Number(id), customerId));
  } catch (e) {
    if (e instanceof CommerceError) return NextResponse.json({ error: e.message, code: e.code, detail: e.detail }, { status: commerceStatus(e.code) });
    return NextResponse.json({ error: "주문 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
