import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/agent-tools/health-profile/route";

function getReq(url: string) {
  return new NextRequest(new Request(url, { method: "GET" }));
}
function postReq(url: string, body: unknown) {
  return new NextRequest(
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("health-profile endpoint", () => {
  it("session_id 없는 GET은 400", async () => {
    const res = await GET(getReq("http://t/api/agent-tools/health-profile"));
    expect(res.status).toBe(400);
  });
  it("POST 저장 후 GET으로 조회된다", async () => {
    const s = "sess-ep-" + Date.now();
    const post = await POST(
      postReq("http://t/api/agent-tools/health-profile", { session_id: s, conditions: ["고혈압"] })
    );
    expect(post.status).toBe(200);
    const got = await GET(getReq(`http://t/api/agent-tools/health-profile?session_id=${s}`));
    const json = await got.json();
    expect(json.conditions).toEqual(["고혈압"]);
  });
});
