import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const schema = z.object({ productId: z.number().int(), quantity: z.number().int().positive().default(1) });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  // 프로토타입: 결제 없이 주문 기록만 생성
  const order = await prisma.order.create({ data: { ...parsed.data, status: "created" } });
  return NextResponse.json(order, { status: 201 });
}
