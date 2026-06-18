import { prisma } from "@/lib/prisma";

export type EntityType = "agentSetting" | "skill" | "knowledgeDocument";

export type RevisionRow = {
  id: number;
  entityType: string;
  entityId: string;
  snapshot: unknown;
  summary: string | null;
  createdAt: string;
};

// 엔터티 저장 직후 호출하는 best-effort 스냅샷 기록(기록 실패가 저장을 막지 않음).
export async function recordRevision(
  entityType: EntityType,
  entityId: string,
  snapshot: unknown,
  summary?: string
): Promise<void> {
  try {
    await prisma.revision.create({
      data: {
        entityType,
        entityId: String(entityId),
        snapshot: JSON.stringify(snapshot),
        summary: summary ?? null,
      },
    });
  } catch (e) {
    console.error(`revision 기록 실패(무시) ${entityType}:${entityId}`, e);
  }
}

function toRow(r: { id: number; entityType: string; entityId: string; snapshot: string; summary: string | null; createdAt: Date }): RevisionRow {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    snapshot: JSON.parse(r.snapshot),
    summary: r.summary,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listRevisions(entityType: EntityType, entityId: string): Promise<RevisionRow[]> {
  const rows = await prisma.revision.findMany({
    where: { entityType, entityId: String(entityId) },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toRow);
}

export async function getRevision(id: number): Promise<RevisionRow | null> {
  const r = await prisma.revision.findUnique({ where: { id } });
  return r ? toRow(r) : null;
}
