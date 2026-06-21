import { NextRequest, NextResponse } from "next/server";
import { listOrders } from "@/lib/orders";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") || undefined;
  const q = sp.get("q") || undefined;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const take = 20;
  const { rows, total } = await listOrders({ status, q, skip: (page - 1) * take, take });
  return NextResponse.json({ rows, total, page, pageSize: take });
}
