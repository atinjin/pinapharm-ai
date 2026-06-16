import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { upsertChunk } from "../src/lib/knowledge";

type Row = {
  원료명: string; 기능성: string; 주의사항: string; 상호작용: string; 일일섭취량: string; 출처: string;
};

async function main() {
  const path = resolve(process.cwd(), "data/ingredient-knowledge.json");
  const rows = JSON.parse(readFileSync(path, "utf8")) as Row[];
  for (const r of rows) {
    const text = `${r.원료명}. 기능성: ${r.기능성}. 주의사항: ${r.주의사항}. 상호작용: ${r.상호작용}. 일일섭취량: ${r.일일섭취량}.`;
    await upsertChunk({
      kind: "ingredient",
      refId: r.원료명,
      title: r.원료명,
      text,
      metadata: { 주의사항: r.주의사항, 상호작용: r.상호작용, 일일섭취량: r.일일섭취량, 출처: r.출처 },
    });
    console.log(`indexed: ${r.원료명}`);
  }
  console.log(`완료: ${rows.length}건`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
