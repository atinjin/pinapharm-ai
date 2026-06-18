import { getRevision } from "@/lib/revisions";
import { setAgentSettings, type AgentSettings } from "@/lib/agentConfig";
import { updateSkill } from "@/lib/skills";
import { updateDocument } from "@/lib/knowledgeAdmin";

// 선택한 버전 스냅샷을 엔터티에 재적용한다. 각 update가 새 버전을 다시 기록한다.
export async function rollbackRevision(id: number): Promise<void> {
  const rev = await getRevision(id);
  if (!rev) throw new Error("버전을 찾을 수 없습니다");
  const snap = rev.snapshot as Record<string, unknown>;

  if (rev.entityType === "agentSetting") {
    await setAgentSettings({ [rev.entityId]: String(snap.value ?? "") } as Partial<AgentSettings>);
  } else if (rev.entityType === "skill") {
    await updateSkill(Number(rev.entityId), {
      name: snap.name as string,
      description: snap.description as string,
      body: snap.body as string,
      isActive: snap.isActive as boolean,
    });
  } else if (rev.entityType === "knowledgeDocument") {
    await updateDocument(Number(rev.entityId), {
      category: snap.category as string,
      title: snap.title as string,
      body: snap.body as string,
      source: (snap.source as Record<string, unknown>) ?? {},
    });
  } else {
    throw new Error(`알 수 없는 entityType: ${rev.entityType}`);
  }
}
