import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { markShipped } from "@/lib/orders";
import { CommerceError, commerceStatus } from "@/lib/commerceErrors";

const schema = z.object({
  carrier: z.enum(["CJ", "LOTTE", "HANJIN", "POST", "LOGEN"]),
  trackingNumber: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const p = schema.safeParse(await req.json());
  if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
  try {
    const order = await markShipped(Number(id), p.data);
    return NextResponse.json(order);
  } catch (e) {
    if (e instanceof CommerceError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: commerceStatus(e.code) });
    return NextResponse.json({ error: "발송 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
