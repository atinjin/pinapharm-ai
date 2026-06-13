/**
 * 식약처 건강기능식품 OpenAPI에서 실제 제품을 가져와 DB에 적재한다.
 * 두 가지 소스를 지원한다 (MFDS_SOURCE 환경변수):
 *   - datagokr (기본): data.go.kr 식약처_건강기능식품정보
 *       https://www.data.go.kr/data/15056760/openapi.do  (HtfsInfoService03/getHtfsItem01)
 *   - foodsafetykorea: 식품안전나라 건강기능식품 품목제조신고(C003)
 *       https://www.foodsafetykorea.go.kr/api/openApiInfo.do?svc_no=C003
 *
 * 사전 준비:
 *   1. 위 페이지에서 활용신청 → 인증키 발급(무료)
 *   2. web/.env 에  MFDS_API_KEY="발급키"  추가 (data.go.kr은 Encoding 키 그대로)
 *
 * 실행:
 *   npm run import:mfds                 # 100건 적재
 *   npm run import:mfds -- 300          # 300건
 *   npm run import:mfds -- 50 --dry-run # 적재 없이 미리보기
 *
 * 적재 제품은 가격 0, isActive=false 로 들어가 진열에 노출되지 않는다.
 * 약사가 어드민에서 가격·재고를 정하고 활성화하면 노출된다.
 */
import { PrismaClient } from "@prisma/client";
import { mapMfdsRow, type MfdsRow } from "../src/lib/mfds";
import { stringifyTags } from "../src/lib/products";

const prisma = new PrismaClient();

/** 응답 JSON 안에서 제품 행 배열을 방어적으로 찾아낸다. */
function extractRows(data: unknown): MfdsRow[] {
  const out: MfdsRow[] = [];
  const looksLikeRow = (o: unknown) =>
    !!o && typeof o === "object" && ["PRDLST_NM", "PRDUCT", "PRODUCT"].some((k) => k in (o as object));
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      if (node.some(looksLikeRow)) out.push(...(node.filter(looksLikeRow) as MfdsRow[]));
      else node.forEach(walk);
    } else if (node && typeof node === "object") {
      if (looksLikeRow(node)) out.push(node as MfdsRow);
      else Object.values(node as Record<string, unknown>).forEach(walk);
    }
  };
  walk(data);
  return out;
}

async function fetchDataGoKr(key: string, count: number): Promise<MfdsRow[]> {
  // 목록조회(getHtfsList01) 우선, 안 되면 상세정보조회(getHtfsItem01) 폴백
  // getHtfsItem01(상세조회)이 기능성 등 풍부한 필드 제공 → 우선 사용
  const ops = (process.env.MFDS_OP ? [process.env.MFDS_OP] : ["getHtfsItem01", "getHtfsList01"]);
  const host = "https://apis.data.go.kr/1471000/HtfsInfoService03";
  let lastErr = "";
  for (const op of ops) {
    const rows: MfdsRow[] = [];
    const perPage = 100;
    try {
      for (let page = 1; rows.length < count; page++) {
        const n = Math.min(perPage, count - rows.length);
        const url = `${host}/${op}?serviceKey=${key}&pageNo=${page}&numOfRows=${n}&type=json`;
        const res = await fetch(url);
        const text = await res.text();
        if (!res.ok || text.trim().startsWith("<") || /unauthorized|service key|errors/i.test(text.slice(0, 60))) {
          throw new Error(`${op} 응답 오류 (page ${page}): ${text.slice(0, 160)}`);
        }
        const got = extractRows(JSON.parse(text));
        if (got.length === 0) break;
        rows.push(...got);
        if (got.length < n) break;
      }
      if (rows.length > 0) {
        console.log(`  (오퍼레이션: ${op})`);
        return rows.slice(0, count);
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr || "data.go.kr에서 데이터를 가져오지 못했습니다.");
}

async function fetchFoodSafety(key: string, count: number, service: string): Promise<MfdsRow[]> {
  const url = `http://openapi.foodsafetykorea.go.kr/api/${key}/${service}/json/1/${count}`;
  const res = await fetch(url);
  const data = (await res.json()) as Record<string, { RESULT?: { CODE: string; MSG: string }; row?: MfdsRow[] }>;
  const block = data[service];
  if (!block) throw new Error(`예상치 못한 응답: ${JSON.stringify(data).slice(0, 160)}`);
  const code = block.RESULT?.CODE ?? "";
  if (!block.row && code && !code.startsWith("INFO-0")) throw new Error(`API 오류: ${code} ${block.RESULT?.MSG ?? ""}`);
  return block.row ?? [];
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const count = Number(args.find((a) => /^\d+$/.test(a)) ?? "100");
  const key = process.env.MFDS_API_KEY;
  const source = process.env.MFDS_SOURCE ?? "datagokr";

  if (!key) {
    console.error("✗ MFDS_API_KEY 가 설정되지 않았습니다. web/.env 에 추가하세요.");
    process.exit(1);
  }

  console.log(`→ [${source}] ${count}건 요청 중…`);
  const rawRows =
    source === "foodsafetykorea"
      ? await fetchFoodSafety(key, count, process.env.MFDS_SERVICE_ID ?? "C003")
      : await fetchDataGoKr(key, count);
  console.log(`← ${rawRows.length}건 수신`);
  if (rawRows[0]) console.log("  샘플 필드:", Object.keys(rawRows[0]).join(", "));

  const mapped = rawRows.map(mapMfdsRow).filter((m): m is NonNullable<typeof m> => m !== null);
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
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
