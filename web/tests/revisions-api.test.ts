import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0, 1])),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { createSkill, updateSkill, deleteSkill } from "@/lib/skills";
import { GET as listRoute } from "@/app/api/admin/revisions/route";
import { POST as rollbackRoute } from "@/app/api/admin/revisions/[id]/rollback/route";

beforeEach(async () => {
  await prisma.revision.deleteMany();
});

describe("admin/revisions API", () => {
  it("lists revisions and rolls back", async () => {
    const s = await createSkill({ name: `api-rb-${Date.now()}`, description: "d", body: "v1" });
    await updateSkill(s.id, { body: "v2" });

    const listRes = await listRoute(
      new NextRequest(`http://localhost/api/admin/revisions?entityType=skill&entityId=${s.id}`)
    );
    const list = await listRes.json();
    expect(list.length).toBe(2);

    const v1 = list.find((r: { snapshot: { body: string } }) => r.snapshot.body === "v1");
    const rbRes = await rollbackRoute(new NextRequest("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ id: String(v1.id) }),
    });
    expect((await rbRes.json()).ok).toBe(true);
    const after = await prisma.consultationSkill.findUnique({ where: { id: s.id } });
    expect(after!.body).toBe("v1");
    await deleteSkill(s.id);
  });

  it("400 on missing params", async () => {
    const res = await listRoute(new NextRequest("http://localhost/api/admin/revisions"));
    expect(res.status).toBe(400);
  });
});
