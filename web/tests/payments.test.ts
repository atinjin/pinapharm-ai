import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import { tossConfirm, tossCancel, verifyWebhookSignature } from "@/lib/payments";

afterEach(() => vi.unstubAllGlobals());

function okFetch(body: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => body }));
}

describe("payments", () => {
  it("tossConfirm: confirm URL + Basic auth + 본문", async () => {
    process.env.TOSS_SECRET_KEY = "test_sk_X";
    const f = okFetch({ paymentKey: "pk", orderId: "ORD-1", status: "DONE", totalAmount: 39000, method: "카드" });
    vi.stubGlobal("fetch", f);
    const r = await tossConfirm({ paymentKey: "pk", orderId: "ORD-1", amount: 39000 });
    expect(r.status).toBe("DONE");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/payments/confirm");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(JSON.parse(init.body as string)).toEqual({ paymentKey: "pk", orderId: "ORD-1", amount: 39000 });
  });

  it("tossConfirm: 비2xx면 PAYMENT_FAILED", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ code: "REJECT_CARD_COMPANY", message: "거절" }) })));
    await expect(tossConfirm({ paymentKey: "x", orderId: "y", amount: 1 })).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
  });

  it("tossCancel: cancel URL + cancelReason", async () => {
    process.env.TOSS_SECRET_KEY = "test_sk_X";
    const f = okFetch({ paymentKey: "pk", orderId: "ORD-1", status: "CANCELED", totalAmount: 39000 });
    vi.stubGlobal("fetch", f);
    await tossCancel("pk", "고객 취소");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/payments/pk/cancel");
    expect(JSON.parse(init.body as string)).toEqual({ cancelReason: "고객 취소" });
  });

  it("verifyWebhookSignature: HMAC-SHA256 검증", () => {
    process.env.TOSS_WEBHOOK_SECRET = "whsec";
    const body = '{"eventType":"PAYMENT_STATUS_CHANGED"}';
    const sig = crypto.createHmac("sha256", "whsec").update(body, "utf8").digest("base64");
    expect(verifyWebhookSignature(body, sig)).toBe(true);
    expect(verifyWebhookSignature(body, "bad")).toBe(false);
    expect(verifyWebhookSignature(body, null)).toBe(false);
  });
});
