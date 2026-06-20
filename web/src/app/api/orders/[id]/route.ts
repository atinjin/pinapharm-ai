import { NextRequest, NextResponse } from "next/server";
import { resolveCustomer } from "@/lib/customers";
import { getOrder } from "@/lib/orders";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sid = req.nextUrl.searchParams.get("session_id");
  if (!sid) return NextResponse.json({ error: "session_id 필요" }, { status: 400 });
  const customerId = await resolveCustomer(sid);
  const order = await getOrder(Number(id), customerId);
  if (!order) return NextResponse.json({ error: "주문을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(order);
}
