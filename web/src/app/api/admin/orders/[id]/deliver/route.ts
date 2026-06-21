import { NextRequest, NextResponse } from "next/server";
import { markDelivered } from "@/lib/orders";
import { CommerceError, commerceStatus } from "@/lib/commerceErrors";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const order = await markDelivered(Number(id));
    return NextResponse.json(order);
  } catch (e) {
    if (e instanceof CommerceError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: commerceStatus(e.code) });
    return NextResponse.json({ error: "배송완료 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
