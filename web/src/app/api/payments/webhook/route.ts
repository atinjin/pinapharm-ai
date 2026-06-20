import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature, tossGetPayment } from "@/lib/payments";
import { reconcileFromToss } from "@/lib/orders";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  // 헤더명은 Toss 문서로 확인(여기서는 tosspayments-webhook-signature 가정)
  const sig = req.headers.get("tosspayments-webhook-signature");
  if (!verifyWebhookSignature(raw, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let event: { data?: { paymentKey?: string; orderId?: string }; paymentKey?: string; orderId?: string };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad payload" }, { status: 400 }); }
  const paymentKey = event.data?.paymentKey ?? event.paymentKey;
  const orderId = event.data?.orderId ?? event.orderId;
  if (paymentKey && orderId) {
    try {
      const payment = await tossGetPayment(paymentKey); // Toss가 source of truth
      await reconcileFromToss(orderId, payment);
    } catch {
      // 재조정 실패는 로깅만, 200 ack(중복 재전송 유도)
    }
  }
  return NextResponse.json({ ok: true });
}
