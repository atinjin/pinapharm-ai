// 개발 DB에 쌓인 web 테스트 데이터를 찾아 지운다. 기본은 dry-run, --apply일 때만 삭제한다.
//   npm run db:cleanup-test            # 대상만 출력
//   npm run db:cleanup-test -- --apply # 삭제
// 식별 기준은 web/tests가 실제로 만드는 데이터 패턴이다. 시드·식약처 import·약사 등록 데이터는 남긴다.
import "dotenv/config";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";

// 커머스 테스트는 매번 이 이름의 약사를 새로 만든다(실제 약사는 id 1 "김약사")
const TEST_PHARMACIST_NAME = "약사";
// pharmacistId 1에 붙여 만드는 테스트 제품(chat/consultations/api-products)
const TEST_PRODUCT_NAMES = ["비타민C 테스트", "테스트제품", "테스트영양제"];
const TEST_PRODUCT_PREFIXES = ["구조화테스트_", "RAG테스트제품_"];
// 실제 세션 ID는 crypto.randomUUID()다. 테스트는 `<접두어>-${Date.now()}[-접미어]`를 쓴다.
export const TEST_SESSION_RE =
  /^(?:adm|o|lst|p|s|ship|pc|dlv|wh|pz|pz2|other|orders-api|goa|empty|bad|bad2|chat|cart-api|sess-(?:c|m|r|new|same|empty|merge|ep))-\d{13}(?:-[a-z0-9]+)?$/;
const TEST_SKILL_RE = /^(?:dryrun|rb-skill|api-rb|corrupt|gone)-\d{13}$/;
const TEST_DOC_TITLE_RE = /^rb-doc-\d{13}$/;
// 지식·제품 색인 테스트는 모두 임베딩을 mock하고 모델명을 이 값으로 둔다
const TEST_EMBEDDING_MODEL = "test-model";
// "성분"·"참고"도 테스트가 만들지만 실제 카테고리 이름일 수 있어 남긴다
const TEST_CATEGORY_NAMES = ["Z카테", "A카테", "구카테", "신카테", "빈카테", "신규"];
const TEST_PERSONA_VALUES = ["페르소나 v1", "페르소나 v2"];
const UNSUMMARIZED_TEST_ENTITIES = ["skill", "agentSetting"];

// 삭제 순서(FK 자식 먼저)
const TABLES = [
  "revision", "agentSetting", "recommendation", "message", "consultation", "orderItem", "order", "cartItem", "cart",
  "healthProfile", "identity", "customer", "knowledgeChunk", "knowledgeDocument", "product", "pharmacist",
  "consultationSkill", "knowledgeCategory",
] as const;
type Table = (typeof TABLES)[number];

export type CleanupPlan = {
  // agentSetting만 문자열 키(key), 나머지는 id
  ids: Record<Exclude<Table, "agentSetting">, number[]> & { agentSetting: string[] };
  keptProducts: { id: number; reason: string }[];
  productSamples: { name: string; count: number }[];
};

const BATCH = 500; // SQLite 바인딩 변수 한도(999) 아래로 나눈다

async function inBatches<T>(ids: number[], fn: (batch: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += BATCH) out.push(...(await fn(ids.slice(i, i + BATCH))));
  return out;
}

export async function planCleanup(prisma: PrismaClient): Promise<CleanupPlan> {
  const testPharmacists = (
    await prisma.pharmacist.findMany({ where: { name: TEST_PHARMACIST_NAME, id: { not: 1 } }, select: { id: true } })
  ).map((p) => p.id);
  const productCandidates = await prisma.product.findMany({
    where: {
      OR: [
        { pharmacistId: { in: testPharmacists } },
        { name: { in: TEST_PRODUCT_NAMES }, brand: null },
        ...TEST_PRODUCT_PREFIXES.map((p) => ({ name: { startsWith: p } })),
      ],
    },
    select: { id: true, name: true },
  });

  const identities = await prisma.identity.findMany({ where: { provider: "anonymous" }, select: { customerId: true, providerAccountId: true } });
  // 고객은 resolveCustomer로만 생기고 항상 identity가 붙는다. identity 없는 고객은 테스트가 직접 만든 것이다.
  const orphans = await prisma.customer.findMany({ where: { identities: { none: {} } }, select: { id: true } });
  const customers = [...new Set([
    ...identities.filter((i) => TEST_SESSION_RE.test(i.providerAccountId)).map((i) => i.customerId),
    ...orphans.map((c) => c.id),
  ])];

  const orders = (await inBatches(customers, (b) => prisma.order.findMany({ where: { customerId: { in: b } }, select: { id: true } }))).map((o) => o.id);
  // 실제 주문에 들어간 제품은 지우면 주문 내역이 깨지므로 남긴다
  const orderSet = new Set(orders);
  const realOrderItems = await inBatches(productCandidates.map((p) => p.id), (b) =>
    prisma.orderItem.findMany({ where: { productId: { in: b } }, select: { productId: true, orderId: true } }),
  );
  const kept = new Set(realOrderItems.filter((i) => !orderSet.has(i.orderId)).map((i) => i.productId));
  const keptProducts = [...kept].map((id) => ({ id, reason: "테스트 외 주문에 포함됨" }));
  const products = productCandidates.filter((p) => !kept.has(p.id));
  const productIds = products.map((p) => p.id);

  const customerSet = new Set(customers);
  const consultations = (
    await prisma.consultation.findMany({ select: { id: true, sessionId: true, customerId: true } })
  ).filter((c) => TEST_SESSION_RE.test(c.sessionId) || (c.customerId !== null && customerSet.has(c.customerId))).map((c) => c.id);

  const recommendations = [
    ...(await inBatches(consultations, (b) => prisma.recommendation.findMany({ where: { consultationId: { in: b } }, select: { id: true } }))),
    ...(await inBatches(productIds, (b) => prisma.recommendation.findMany({ where: { productId: { in: b } }, select: { id: true } }))),
  ].map((r) => r.id);
  const carts = (await inBatches(customers, (b) => prisma.cart.findMany({ where: { customerId: { in: b } }, select: { id: true } }))).map((c) => c.id);
  const cartItems = [
    ...(await inBatches(carts, (b) => prisma.cartItem.findMany({ where: { cartId: { in: b } }, select: { id: true } }))),
    ...(await inBatches(productIds, (b) => prisma.cartItem.findMany({ where: { productId: { in: b } }, select: { id: true } }))),
  ].map((c) => c.id);

  const skills = (await prisma.consultationSkill.findMany({ select: { id: true, name: true } })).filter((s) => TEST_SKILL_RE.test(s.name)).map((s) => s.id);
  const docs = await prisma.knowledgeDocument.findMany({ select: { id: true, title: true, chunks: { select: { model: true } } } });
  const documents = docs
    .filter((d) => TEST_DOC_TITLE_RE.test(d.title) || (d.chunks.length > 0 && d.chunks.every((c) => c.model === TEST_EMBEDDING_MODEL)))
    .map((d) => d.id);
  const docSet = new Set(documents);
  const skillSet = new Set(skills);
  const productRefs = new Set(productIds.map(String));
  const chunks = (
    await prisma.knowledgeChunk.findMany({ select: { id: true, model: true, documentId: true, kind: true, refId: true } })
  )
    .filter((c) => c.model === TEST_EMBEDDING_MODEL || (c.documentId !== null && docSet.has(c.documentId)) ||
      (c.kind === "product" && c.refId !== null && productRefs.has(c.refId)))
    .map((c) => c.id);

  const settings = (await prisma.agentSetting.findMany({ where: { key: "persona", value: { in: TEST_PERSONA_VALUES } }, select: { key: true } })).map((s) => s.key);
  const revisions = (await prisma.revision.findMany({ select: { id: true, entityType: true, entityId: true, snapshot: true, summary: true } }))
    .filter((r) =>
      // skills.ts·agentConfig.ts는 항상 summary를 남긴다. 없으면 테스트가 직접 기록한 것이다(지식문서 수정은 실제로도 summary가 없어 제외).
      (UNSUMMARIZED_TEST_ENTITIES.includes(r.entityType) && r.summary === null) ||
      (r.entityType === "skill" && skillSet.has(Number(r.entityId))) ||
      (r.entityType === "knowledgeDocument" && docSet.has(Number(r.entityId))) ||
      (r.entityType === "agentSetting" && r.entityId === "persona" && TEST_PERSONA_VALUES.includes(personaValue(r.snapshot))))
    .map((r) => r.id);
  const categories = (await prisma.knowledgeCategory.findMany({ where: { name: { in: TEST_CATEGORY_NAMES } }, select: { id: true } })).map((c) => c.id);

  // 약사는 남는 제품이 없을 때만 지운다
  const keptOwners = new Set(
    (await prisma.product.findMany({ where: { id: { in: [...kept] } }, select: { pharmacistId: true } })).map((p) => p.pharmacistId),
  );
  const pharmacists = testPharmacists.filter((id) => !keptOwners.has(id));

  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  const productSamples = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20);

  const children = await childIds(prisma, consultations, orders, customers);
  return {
    ids: {
      revision: revisions, agentSetting: settings, recommendation: [...new Set(recommendations)], message: children.message,
      consultation: consultations, orderItem: children.orderItem, order: orders, cartItem: [...new Set(cartItems)], cart: carts,
      healthProfile: children.healthProfile, identity: children.identity, customer: customers,
      knowledgeChunk: chunks, knowledgeDocument: documents, product: productIds, pharmacist: pharmacists,
      consultationSkill: skills, knowledgeCategory: categories,
    },
    keptProducts,
    productSamples,
  };
}

function personaValue(snapshot: string): string {
  try {
    return String((JSON.parse(snapshot) as { value?: unknown }).value ?? "");
  } catch {
    return "";
  }
}

async function childIds(prisma: PrismaClient, consultations: number[], orders: number[], customers: number[]) {
  const pick = (rows: { id: number }[]) => rows.map((r) => r.id);
  return {
    message: pick(await inBatches(consultations, (b) => prisma.message.findMany({ where: { consultationId: { in: b } }, select: { id: true } }))),
    orderItem: pick(await inBatches(orders, (b) => prisma.orderItem.findMany({ where: { orderId: { in: b } }, select: { id: true } }))),
    healthProfile: pick(await inBatches(customers, (b) => prisma.healthProfile.findMany({ where: { customerId: { in: b } }, select: { id: true } }))),
    identity: pick(await inBatches(customers, (b) => prisma.identity.findMany({ where: { customerId: { in: b } }, select: { id: true } }))),
  };
}

export async function applyCleanup(prisma: PrismaClient, plan: CleanupPlan): Promise<Record<Table, number>> {
  const deleted = {} as Record<Table, number>;
  await prisma.$transaction(async (tx) => {
    for (const table of TABLES) {
      const ids: (number | string)[] = plan.ids[table];
      let n = 0;
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const where = table === "agentSetting" ? { key: { in: batch } } : { id: { in: batch } };
        // 테이블마다 delegate 타입이 달라 공통 시그니처로 좁힌다
        const delegate = tx[table] as unknown as { deleteMany: (args: { where: unknown }) => Promise<{ count: number }> };
        n += (await delegate.deleteMany({ where })).count;
      }
      deleted[table] = n;
    }
  });
  return deleted;
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const apply = process.argv.includes("--apply");
  const plan = await planCleanup(prisma);
  console.log(`DB: ${process.env.DATABASE_URL}  모드: ${apply ? "APPLY(삭제)" : "dry-run(삭제 안 함)"}`);
  console.log("\n테이블별 삭제 대상");
  for (const t of TABLES) console.log(`  ${t.padEnd(18)} ${plan.ids[t].length}`);
  console.log("\n삭제 대상 제품명 상위 20");
  for (const s of plan.productSamples) console.log(`  ${s.count}\t${s.name}`);
  if (plan.keptProducts.length) {
    console.log("\n남기는 테스트 제품");
    for (const k of plan.keptProducts) console.log(`  #${k.id}\t${k.reason}`);
  }
  const total = await prisma.product.count();
  console.log(`\n제품: 현재 ${total} → 정리 후 ${total - plan.ids.product.length}`);
  if (!apply) {
    console.log("\ndry-run이라 아무것도 지우지 않았습니다. 삭제하려면 --apply");
    return;
  }
  const deleted = await applyCleanup(prisma, plan);
  console.log("\n삭제 완료", deleted);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
