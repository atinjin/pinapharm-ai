import { NextRequest, NextResponse } from "next/server";
import { listRevisions, type EntityType } from "@/lib/revisions";

const TYPES = ["agentSetting", "skill", "knowledgeDocument"];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const entityType = sp.get("entityType");
  const entityId = sp.get("entityId");
  if (!entityType || !entityId || !TYPES.includes(entityType))
    return NextResponse.json({ error: "entityType·entityId가 필요합니다" }, { status: 400 });
  return NextResponse.json(await listRevisions(entityType as EntityType, entityId));
}
