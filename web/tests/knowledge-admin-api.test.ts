import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map((t) => (t.includes("눈") ? [1, 0] : [0, 1]))),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { GET as list, POST as create } from "@/app/api/admin/knowledge/route";
import { GET as getOne, PUT as put, DELETE as del } from "@/app/api/admin/knowledge/[id]/route";
import { POST as review } from "@/app/api/admin/knowledge/[id]/review/route";
import { GET as search } from "@/app/api/admin/knowledge/search/route";

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
});

function post(url: string, body: unknown) {
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("admin/knowledge API", () => {
  it("creates, lists, gets, updates(review reset), reviews, searches, deletes", async () => {
    // create
    const cRes = await create(post("http://localhost/api/admin/knowledge", { category: "ingredient", title: "루테인", body: "눈 건강 유지", source: { 출처: "식약처" } }));
    expect(cRes.status).toBe(201);
    const { id } = await cRes.json();
    expect(id).toBeGreaterThan(0);

    // list
    const lRes = await list(new NextRequest("http://localhost/api/admin/knowledge?category=ingredient"));
    const lBody = await lRes.json();
    expect(lBody.total).toBe(1);
    expect(lBody.rows[0].title).toBe("루테인");

    // get one (with chunks, no embedding bytes)
    const gRes = await getOne(new NextRequest("http://localhost/x"), ctx(id));
    const gBody = await gRes.json();
    expect(gBody.chunks.length).toBeGreaterThan(0);
    expect(gBody.source.출처).toBe("식약처");

    // review then verify filter
    await review(post(`http://localhost/x`, { reviewed: true }), ctx(id));
    const reviewedList = await (await list(new NextRequest("http://localhost/api/admin/knowledge?reviewed=true"))).json();
    expect(reviewedList.total).toBe(1);

    // update body → review reset
    await put(post("http://localhost/x", { body: "새 내용" }), ctx(id));
    const afterUpdate = await (await list(new NextRequest("http://localhost/api/admin/knowledge?reviewed=true"))).json();
    expect(afterUpdate.total).toBe(0); // 검수 리셋됨

    // search test
    const sRes = await search(new NextRequest("http://localhost/api/admin/knowledge/search?q=눈&k=3"));
    expect(Array.isArray(await sRes.json())).toBe(true);

    // delete
    const dRes = await del(new NextRequest("http://localhost/x"), ctx(id));
    expect((await dRes.json()).ok).toBe(true);
    expect(await prisma.knowledgeDocument.count()).toBe(0);
  });

  it("400 on invalid create (missing title/body)", async () => {
    const res = await create(post("http://localhost/api/admin/knowledge", { title: "" }));
    expect(res.status).toBe(400);
  });
});
