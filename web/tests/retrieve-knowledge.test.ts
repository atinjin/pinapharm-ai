import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map((t) => (t.includes("오메가") ? [1, 0] : [0, 1]))),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { upsertChunk } from "@/lib/knowledge";
import { GET } from "@/app/api/agent-tools/retrieve-knowledge/route";

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
});

it("returns ranked knowledge hits as JSON", async () => {
  await upsertChunk({ kind: "ingredient", refId: "오메가3", title: "오메가3", text: "오메가 혈행", metadata: { 주의사항: "출혈 위험" } });
  const req = new NextRequest("http://localhost/api/agent-tools/retrieve-knowledge?q=오메가&k=3");
  const res = await GET(req);
  const body = await res.json();
  expect(body[0].title).toBe("오메가3");
  expect(body[0].metadata.주의사항).toBe("출혈 위험");
});

it("400 when q missing", async () => {
  const req = new NextRequest("http://localhost/api/agent-tools/retrieve-knowledge");
  const res = await GET(req);
  expect(res.status).toBe(400);
});
