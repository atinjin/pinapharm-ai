import { NextRequest } from "next/server";
import { resolveCustomer } from "@/lib/customers";
import { getOrCreateConsultation, appendMessage, saveRecommendations } from "@/lib/consultations";
import { extractFromSSE } from "@/lib/agentStream";

// 클라이언트 메시지+session_id를 agent로 중계하고, 스트림을 거울처럼 통과시키며
// 상담 메시지/추천을 DB에 적재한다.
export async function POST(req: NextRequest) {
  const { message, session_id } = (await req.json()) as { message: string; session_id: string };
  const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000";

  // 적재 준비 (실패해도 상담은 계속 진행)
  let consultationId: number | null = null;
  try {
    const customerId = await resolveCustomer(session_id);
    consultationId = await getOrCreateConsultation(session_id, customerId);
    await appendMessage(consultationId, "user", message);
  } catch {
    // 적재 실패는 무시
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${agentUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id }),
    });
  } catch {
    return new Response("상담 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.", { status: 502 });
  }

  const sseHeaders = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };
  if (!upstream.body) {
    return new Response(null, { status: upstream.status, headers: sseHeaders });
  }
  const body = teeAndPersist(upstream.body, consultationId);
  return new Response(body, { status: upstream.status, headers: sseHeaders });
}

// 업스트림 스트림을 클라이언트로 그대로 흘려보내면서 원문을 모아두었다가,
// 완료 시 어시스턴트 답변과 추천을 적재한다.
function teeAndPersist(
  upstream: ReadableStream<Uint8Array>,
  consultationId: number | null
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let raw = "";
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
          controller.enqueue(value);
        }
      } finally {
        try { reader.releaseLock(); } catch {}
        controller.close();
        if (consultationId !== null) {
          const { text, ids } = extractFromSSE(raw);
          try {
            if (text) await appendMessage(consultationId, "assistant", text);
            if (ids.length) await saveRecommendations(consultationId, ids);
          } catch {
            // 적재 실패는 무시
          }
        }
      }
    },
  });
}
