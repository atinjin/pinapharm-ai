import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0, 1])),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { listRevisions } from "@/lib/revisions";
import { rollbackRevision } from "@/lib/rollback";
import { createSkill, updateSkill, deleteSkill } from "@/lib/skills";
import { setAgentSettings, getAgentSettings } from "@/lib/agentConfig";
import { createDocument } from "@/lib/knowledge";
import { updateDocument } from "@/lib/knowledgeAdmin";

beforeEach(async () => {
  await prisma.revision.deleteMany();
});

const snapBody = (r: { snapshot: unknown }) => (r.snapshot as { body?: string; value?: string });

describe("rollbackRevision", () => {
  it("rolls a skill back to a prior body", async () => {
    const s = await createSkill({ name: `rb-skill-${Date.now()}`, description: "d", body: "v1" });
    await updateSkill(s.id, { body: "v2" });
    const v1 = (await listRevisions("skill", String(s.id))).find((r) => snapBody(r).body === "v1")!;
    await rollbackRevision(v1.id);
    const after = await prisma.consultationSkill.findUnique({ where: { id: s.id } });
    expect(after!.body).toBe("v1");
    await deleteSkill(s.id);
  });

  it("rolls an agentSetting back to a prior value", async () => {
    await setAgentSettings({ persona: "페르소나 v1" });
    await setAgentSettings({ persona: "페르소나 v2" });
    const v1 = (await listRevisions("agentSetting", "persona")).find((r) => snapBody(r).value === "페르소나 v1")!;
    await rollbackRevision(v1.id);
    expect((await getAgentSettings()).persona).toBe("페르소나 v1");
    await prisma.agentSetting.deleteMany({ where: { key: "persona" } });
  });

  it("rolls a knowledge document back (re-chunked)", async () => {
    const d = await createDocument({ title: `rb-doc-${Date.now()}`, body: "본문 v1" });
    await updateDocument(d.id, { body: "본문 v2" });
    const v1 = (await listRevisions("knowledgeDocument", String(d.id))).find((r) => snapBody(r).body === "본문 v1")!;
    await rollbackRevision(v1.id);
    const after = await prisma.knowledgeDocument.findUnique({ where: { id: d.id } });
    expect(after!.body).toBe("본문 v1");
    await prisma.knowledgeDocument.delete({ where: { id: d.id } });
  });
});
