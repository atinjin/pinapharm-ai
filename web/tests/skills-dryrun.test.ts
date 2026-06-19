import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/admin/skills/dryrun/route";

let skillId: number;

beforeEach(async () => {
  const s = await prisma.consultationSkill.create({
    data: { name: `dryrun-${Date.now()}`, description: "d", body: "절차 본문" },
  });
  skillId = s.id;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await prisma.consultationSkill.delete({ where: { id: skillId } }).catch(() => {});
});

function post(body: unknown) {
  return new NextRequest("http://localhost/api/admin/skills/dryrun", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("admin/skills/dryrun proxy", () => {
  it("proxies skill body to agent and returns response", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      void init;
      return { ok: true, json: async () => ({ response: "드라이런 결과" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(post({ skillId, query: "콧물이 나요" }));
    expect((await res.json()).response).toBe("드라이런 결과");
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.skill_body).toBe("절차 본문");
    expect(sent.query).toBe("콧물이 나요");
  });

  it("502 when agent unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("conn"); }));
    const res = await POST(post({ skillId, query: "콧물" }));
    expect(res.status).toBe(502);
  });

  it("404 when skill missing", async () => {
    const res = await POST(post({ skillId: 999999, query: "콧물" }));
    expect(res.status).toBe(404);
  });
});
