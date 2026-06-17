import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma";
import { createDocument } from "../src/lib/knowledge";

type Row = {
  원료명: string; 기능성: string; 주의사항: string; 상호작용: string; 일일섭취량: string; 출처: string;
};

async function main() {
  // 레거시(문서 이전 모델)의 ingredient 청크 정리 — 1회성, 멱등
  const legacy = await prisma.knowledgeChunk.deleteMany({ where: { kind: "ingredient" } });
  if (legacy.count) console.log(`레거시 ingredient 청크 ${legacy.count}건 삭제`);

  const path = resolve(process.cwd(), "data/ingredient-knowledge.json");
  const rows = JSON.parse(readFileSync(path, "utf8")) as Row[];
  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    // insert-if-absent: 같은 제목 문서가 있으면 건너뜀(대시보드 편집 보존)
    const existing = await prisma.knowledgeDocument.findFirst({ where: { title: r.원료명 } });
    if (existing) {
      skipped++;
      console.log(`skip(존재): ${r.원료명}`);
      continue;
    }
    const body = `${r.원료명}. 기능성: ${r.기능성}. 주의사항: ${r.주의사항}. 상호작용: ${r.상호작용}. 일일섭취량: ${r.일일섭취량}.`;
    await createDocument({
      category: "ingredient",
      title: r.원료명,
      body,
      source: { 주의사항: r.주의사항, 상호작용: r.상호작용, 일일섭취량: r.일일섭취량, 출처: r.출처 },
    });
    created++;
    console.log(`indexed: ${r.원료명}`);
  }
  console.log(`완료: 생성 ${created} / 건너뜀 ${skipped}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
