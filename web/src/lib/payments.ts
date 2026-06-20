import crypto from "node:crypto";

const TOSS_API = "https://api.tosspayments.com/v1";

export type TossPayment = {
  paymentKey: string;
  orderId: string;
  status: string; // DONE | CANCELED | ...
  method?: string;
  totalAmount: number;
  approvedAt?: string;
};

function authHeader(): string {
  const key = process.env.TOSS_SECRET_KEY ?? "";
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

async function tossFetch(path: string, init: RequestInit): Promise<TossPayment> {
  const res = await fetch(`${TOSS_API}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { message?: string })?.message ?? "toss error") as Error & { code?: string; tossCode?: string };
    err.code = "PAYMENT_FAILED";
    err.tossCode = (data as { code?: string })?.code;
    throw err;
  }
  return data as TossPayment;
}

export function tossConfirm(params: { paymentKey: string; orderId: string; amount: number }): Promise<TossPayment> {
  return tossFetch("/payments/confirm", { method: "POST", body: JSON.stringify(params) });
}

export function tossCancel(paymentKey: string, cancelReason: string): Promise<TossPayment> {
  return tossFetch(`/payments/${encodeURIComponent(paymentKey)}/cancel`, { method: "POST", body: JSON.stringify({ cancelReason }) });
}

export function tossGetPayment(paymentKey: string): Promise<TossPayment> {
  return tossFetch(`/payments/${encodeURIComponent(paymentKey)}`, { method: "GET" });
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.TOSS_WEBHOOK_SECRET ?? "";
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
