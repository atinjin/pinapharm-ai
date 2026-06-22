import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/admin/knowledge-categories/route";
import { PUT, DELETE } from "@/app/api/admin/knowledge-categories/[id]/route";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0, 1])),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { createDocument } from "@/lib/knowledge";

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.knowledgeCategory.deleteMany();
  await prisma.knowledgeCategory.create({ data: { name: "미분류", displayOrder: 9999 } });
});

function get(url: string) {
  return new NextRequest(url);
}
function post(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
function put(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
function del(url: string) {
  return new NextRequest(url, { method: "DELETE" });
}
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("GET /api/admin/knowledge-categories", () => {
  it("200 + rows 배열(미분류 포함)", async () => {
    const res = await GET(get("http://localhost/api/admin/knowledge-categories"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows.some((r: { name: string }) => r.name === "미분류")).toBe(true);
  });

  it("docCount 집계 포함", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "성분" } });
    await createDocument({ category: "성분", title: "비타민C", body: "항산화" });
    const res = await GET(get("http://localhost/api/admin/knowledge-categories"));
    const body = await res.json();
    const 성분 = body.rows.find((r: { name: string }) => r.name === "성분");
    expect(성분.docCount).toBe(1);
  });
});

describe("POST /api/admin/knowledge-categories", () => {
  it("정상 생성 → 201", async () => {
    const res = await POST(
      post("http://localhost/api/admin/knowledge-categories", {
        name: "신규",
        icon: "💊",
        color: "bg-blue-100 text-blue-700",
        displayOrder: 1,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("신규");
  });

  it("중복 이름 → 409", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "성분" } });
    const res = await POST(
      post("http://localhost/api/admin/knowledge-categories", { name: "성분" })
    );
    expect(res.status).toBe(409);
  });

  it("빈 name → 400", async () => {
    const res = await POST(
      post("http://localhost/api/admin/knowledge-categories", { name: "" })
    );
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/admin/knowledge-categories/[id]", () => {
  it("정상 수정 → 200", async () => {
    const cat = await prisma.knowledgeCategory.create({ data: { name: "구카테" } });
    const res = await PUT(
      put(`http://localhost/api/admin/knowledge-categories/${cat.id}`, { name: "신카테", icon: "🌿" }),
      ctx(cat.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("신카테");
  });

  it("'미분류' 이름 변경 → 403", async () => {
    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "미분류" } });
    const res = await PUT(
      put(`http://localhost/api/admin/knowledge-categories/${cat!.id}`, { name: "다른이름" }),
      ctx(cat!.id)
    );
    expect(res.status).toBe(403);
  });

  it("없는 id → 404", async () => {
    const res = await PUT(
      put("http://localhost/api/admin/knowledge-categories/999999", { name: "X" }),
      ctx(999999)
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/knowledge-categories/[id]", () => {
  it("docCount=0 → 200 { movedCount: 0 }", async () => {
    const cat = await prisma.knowledgeCategory.create({ data: { name: "빈카테" } });
    const res = await DELETE(
      del(`http://localhost/api/admin/knowledge-categories/${cat.id}`),
      ctx(cat.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.movedCount).toBe(0);
  });

  it("docCount>0 → 200 { movedCount: N } + 문서 미분류 이동", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "성분" } });
    await createDocument({ category: "성분", title: "루테인", body: "눈" });
    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "성분" } });
    const res = await DELETE(
      del(`http://localhost/api/admin/knowledge-categories/${cat!.id}`),
      ctx(cat!.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.movedCount).toBe(1);
  });

  it("'미분류' 삭제 → 403", async () => {
    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "미분류" } });
    const res = await DELETE(
      del(`http://localhost/api/admin/knowledge-categories/${cat!.id}`),
      ctx(cat!.id)
    );
    expect(res.status).toBe(403);
  });

  it("없는 id → 404", async () => {
    const res = await DELETE(
      del("http://localhost/api/admin/knowledge-categories/999999"),
      ctx(999999)
    );
    expect(res.status).toBe(404);
  });
});
