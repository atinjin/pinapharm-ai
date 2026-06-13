import { NextRequest } from "next/server";

// 클라이언트의 대화 이력을 agent 서비스로 그대로 전달하고 스트림을 중계한다.
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
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return new Response("상담 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.", { status: 502 });
  }
}
