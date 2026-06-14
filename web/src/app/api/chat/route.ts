import { NextRequest } from "next/server";

// 클라이언트의 단일 메시지+session_id를 agent 서비스로 전달하고 SSE 스트림을 중계한다.
export async function POST(req: NextRequest) {
  const body = await req.text();
  const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000";
  try {
    const upstream = await fetch(`${agentUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return new Response("상담 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.", { status: 502 });
  }
}
