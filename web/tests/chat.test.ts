import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/chat/route";

describe("/api/chat 상담/추천 적재", () => {
  let productId: number;

  beforeAll(async () => {
    await prisma.pharmacist.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: "김약사" } });
    const product = await prisma.product.create({ data: { name: "비타민C 테스트", price: 5000, pharmacistId: 1 } });
    productId = product.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("유저/어시스턴트 메시지 적재, 추천 적재", async () => {
    const SID = "chat-" + Date.now();
    const encoder = new TextEncoder();

    // Build SSE stream that the stubbed fetch returns
    const sseFrames = [
      `event: plan\ndata: {"steps":["증상 정리"]}\n\n`,
      `event: token\ndata: {"text":"비타민"}\n\n`,
      `event: token\ndata: {"text":"C 추천"}\n\n`,
      `event: recommendations\ndata: {"ids":[${productId}]}\n\n`,
      `event: done\ndata: {}\n\n`,
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of sseFrames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      },
    });

    const fakeAgentResponse = new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeAgentResponse));

    const req = new NextRequest(
      new Request("http://t/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "피곤해요", session_id: SID }),
      })
    );

    const res = await POST(req);

    // Drain the response body so the stream's finally block runs
    const reader = res.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Poll the DB for up to 2s — persistence happens in stream's finally after controller.close()
    let consultation: { id: number } | null = null;
    let assistantMsg: { content: string } | null = null;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      consultation = await prisma.consultation.findFirst({ where: { sessionId: SID } });
      if (consultation) {
        assistantMsg = await prisma.message.findFirst({
          where: { consultationId: consultation.id, role: "assistant" },
        });
        if (assistantMsg) break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(consultation).not.toBeNull();
    const cid = consultation!.id;

    // User message
    const userMsg = await prisma.message.findFirst({ where: { consultationId: cid, role: "user" } });
    expect(userMsg).not.toBeNull();
    expect(userMsg!.content).toBe("피곤해요");

    // Assistant message (concatenated tokens)
    expect(assistantMsg).not.toBeNull();
    expect(assistantMsg!.content).toBe("비타민C 추천");

    // Recommendation row
    const rec = await prisma.recommendation.findFirst({ where: { consultationId: cid, productId } });
    expect(rec).not.toBeNull();
  });
});
