import { NextRequest, NextResponse } from "next/server";
import { getOrderAdmin } from "@/lib/orders";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const order = await getOrderAdmin(Number(id));
  if (!order) return NextResponse.json({ error: "주문을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(order);
}
