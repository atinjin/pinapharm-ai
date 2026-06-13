/**
 * 식품안전나라 건강기능식품 품목제조신고(C003) OpenAPI에서 실제 제품을 가져와 DB에 적재한다.
 *
 * 사전 준비:
 *   1. https://www.foodsafetykorea.go.kr/api/openApiInfo.do?svc_no=C003 에서 API 인증키 신청(무료)
 *   2. web/.env 에  MFDS_API_KEY="발급키"  추가
 *
 * 실행:
 *   npm run import:mfds            # 100건 가져와 적재
 *   npm run import:mfds -- 300     # 300건
 *   npm run import:mfds -- 50 --dry-run   # 적재 없이 미리보기
 *
 * 적재된 제품은 가격 0, isActive=false 로 들어가므로 진열에는 노출되지 않는다.
 * 약사가 어드민에서 가격·재고를 정하고 활성화하면 노출된다.
 */
import { PrismaClient } from "@prisma/client";
import { mapMfdsRow, type MfdsRow } from "../src/lib/mfds";
import { stringifyTags } from "../src/lib/products";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const count = Number(args.find((a) => /^\d+$/.test(a)) ?? "100");
  const key = process.env.MFDS_API_KEY;
  const service = process.env.MFDS_SERVICE_ID ?? "C003";

  if (!key) {
    console.error("✗ MFDS_API_KEY 가 설정되지 않았습니다. web/.env 에 추가하세요.");
    console.error("  키 발급: https://www.foodsafetykorea.go.kr/api/openApiInfo.do?svc_no=C003");
    process.exit(1);
  }

  const url = `http://openapi.foodsafetykorea.go.kr/api/${key}/${service}/json/1/${count}`;
  console.log(`→ ${service} 에서 ${count}건 요청 중…`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`✗ HTTP ${res.status}`);
    process.exit(1);
  }
  const data = (await res.json()) as Record<string, { RESULT?: { CODE: string; MSG: string }; row?: MfdsRow[] }>;
  const block = data[service];
  if (!block) {
    console.error("✗ 예상치 못한 응답 형식:", JSON.stringify(data).slice(0, 200));
    process.exit(1);
  }
  const resultCode = block.RESULT?.CODE ?? "";
  if (!block.row && resultCode && !resultCode.startsWith("INFO-0")) {
    console.error(`✗ API 오류: ${resultCode} ${block.RESULT?.MSG ?? ""}`);
    process.exit(1);
  }
  const rawRows = block.row ?? [];
  console.log(`← ${rawRows.length}건 수신`);
  if (rawRows[0]) console.log("  샘플 필드:", Object.keys(rawRows[0]).join(", "));

  const mapped = rawRows.map(mapMfdsRow).filter((m): m is NonNullable<typeof m> => m !== null);

  // 이름으로 중복 제거 (이미 등록된 것 skip)
  const existing = new Set((await prisma.product.findMany({ select: { name: true } })).map((p) => p.name));
  const fresh = mapped.filter((m) => !existing.has(m.name));
  console.log(`매핑 ${mapped.length}건, 신규 ${fresh.length}건 (기존 중복 ${mapped.length - fresh.length}건 제외)`);

  if (dryRun) {
    console.log("\n[dry-run] 미리보기 (상위 5건):");
    fresh.slice(0, 5).forEach((m) => console.log(`  · ${m.name} / ${m.brand ?? "-"} / 태그: ${m.conditionTags.join(",") || "-"}`));
    console.log("\n--dry-run 이므로 DB에 적재하지 않았습니다.");
    return;
  }

  let created = 0;
  for (const m of fresh) {
    const { conditionTags, ...rest } = m;
    try {
      await prisma.product.create({
        data: { ...rest, pharmacistId: 1, conditionTags: stringifyTags(conditionTags) },
      });
      created++;
    } catch (e) {
      console.warn(`  ! ${m.name} 적재 실패: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`\n✓ ${created}건 적재 완료 (가격 0 · 비활성). 어드민에서 가격·재고 설정 후 활성화하세요.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
