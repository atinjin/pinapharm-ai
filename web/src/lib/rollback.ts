import { getRevision } from "@/lib/revisions";
import { setAgentSettings, type AgentSettings } from "@/lib/agentConfig";
import { updateSkill } from "@/lib/skills";
import { updateDocument } from "@/lib/knowledgeAdmin";

function reqStr(v: unknown, name: string): string {
  if (typeof v !== "string") throw new Error(`스냅샷이 손상되었습니다(${name} 누락)`);
  return v;
}

// 선택한 버전 스냅샷을 엔터티에 재적용한다. 각 update가 새 버전을 다시 기록한다.
// 스냅샷 필드를 검증해 손상된 버전의 부분 롤백/데이터 손실을 막는다.
export async function rollbackRevision(id: number): Promise<void> {
  const rev = await getRevision(id);
  if (!rev) throw new Error("버전을 찾을 수 없습니다");
  const snap = rev.snapshot as Record<string, unknown>;

  if (rev.entityType === "agentSetting") {
    await setAgentSettings({ [rev.entityId]: reqStr(snap.value, "value") } as Partial<AgentSettings>);
  } else if (rev.entityType === "skill") {
    await updateSkill(Number(rev.entityId), {
      name: reqStr(snap.name, "name"),
      description: reqStr(snap.description, "description"),
      body: reqStr(snap.body, "body"),
      isActive: typeof snap.isActive === "boolean" ? snap.isActive : true,
    });
  } else if (rev.entityType === "knowledgeDocument") {
    await updateDocument(Number(rev.entityId), {
      category: reqStr(snap.category, "category"),
      title: reqStr(snap.title, "title"),
      body: reqStr(snap.body, "body"),
      source: (snap.source as Record<string, unknown>) ?? {},
    });
  } else {
    throw new Error(`알 수 없는 entityType: ${rev.entityType}`);
  }
}
