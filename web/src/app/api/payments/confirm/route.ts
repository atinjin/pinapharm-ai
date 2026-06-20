import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveCustomer } from "@/lib/customers";
import { confirmPayment } from "@/lib/orders";
import { CommerceError, commerceStatus } from "@/lib/commerceErrors";

const schema = z.object({ session_id: z.string().min(1), paymentKey: z.string().min(1), orderId: z.string().min(1), amount: z.number().int() });

export async function POST(req: NextRequest) {
  const p = schema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  try {
    const customerId = await resolveCustomer(p.data.session_id);
    const order = await confirmPayment(p.data.orderId, p.data.paymentKey, p.data.amount, customerId);
    return NextResponse.json(order);
  } catch (e) {
    if (e instanceof CommerceError) return NextResponse.json({ error: e.message, code: e.code, detail: e.detail }, { status: commerceStatus(e.code) });
    if ((e as { code?: string })?.code === "PAYMENT_FAILED") return NextResponse.json({ error: "결제 승인에 실패했습니다.", code: "PAYMENT_FAILED" }, { status: 502 });
    return NextResponse.json({ error: "결제 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
