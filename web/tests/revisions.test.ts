import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordRevision, listRevisions, getRevision } from "@/lib/revisions";

beforeEach(async () => {
  await prisma.revision.deleteMany();
});

describe("revisions", () => {
  it("records and lists newest-first, filtered by entity", async () => {
    await recordRevision("skill", "1", { body: "v1" });
    await recordRevision("skill", "1", { body: "v2" });
    await recordRevision("skill", "2", { body: "other" });

    const list = await listRevisions("skill", "1");
    expect(list).toHaveLength(2);
    expect((list[0].snapshot as { body: string }).body).toBe("v2");
    expect((list[1].snapshot as { body: string }).body).toBe("v1");
  });

  it("getRevision returns parsed snapshot", async () => {
    await recordRevision("agentSetting", "persona", { value: "약사 페르소나" });
    const [rev] = await listRevisions("agentSetting", "persona");
    const got = await getRevision(rev.id);
    expect((got!.snapshot as { value: string }).value).toBe("약사 페르소나");
  });
});
