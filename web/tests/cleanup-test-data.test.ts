import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { planCleanup, applyCleanup, TEST_SESSION_RE } from "../scripts/cleanup-test-data";

const TS = "1782136259137";
const vec = Buffer.from([0, 1]);

async function chunk(model: string, extra: { documentId?: number; kind?: string; refId?: string } = {}) {
  return prisma.knowledgeChunk.create({
    data: { kind: extra.kind ?? "knowledge", refId: extra.refId, documentId: extra.documentId, title: "t", text: "x", embedding: vec, model },
  });
}

async function anonymous(sessionId: string) {
  return prisma.customer.create({ data: { identities: { create: { provider: "anonymous", providerAccountId: sessionId } } } });
}

// 실제 데이터와 web/tests가 만드는 패턴의 데이터를 섞어 넣는다
async function seedMixed() {
  await prisma.pharmacist.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: "김약사" } });
  const real = {
    seedProduct: await prisma.product.create({ data: { pharmacistId: 1, name: "비타민C 1000", brand: "헬스랩", price: 18000 } }),
    mfdsProduct: await prisma.product.create({ data: { pharmacistId: 1, name: "락토핏 골드", brand: "종근당", price: 12900 } }),
    customer: await anonymous("6f1c2a9e-3b7d-4e21-9c0a-1d2e3f4a5b6c"),
    skill: await prisma.consultationSkill.create({ data: { name: `수면-상담-${TS}`, description: "d", body: "b" } }),
    doc: await prisma.knowledgeDocument.create({ data: { title: "루테인 가이드", body: "실제 문서" } }),
    category: await prisma.knowledgeCategory.create({ data: { name: `실제카테-${TS}` } }),
  };
  const realChunk = await chunk("voyage-3.5", { documentId: real.doc.id });
  const realConsult = await prisma.consultation.create({ data: { sessionId: "6f1c2a9e-3b7d-4e21-9c0a-1d2e3f4a5b6c", customerId: real.customer.id } });
  const realRec = await prisma.recommendation.create({ data: { consultationId: realConsult.id, productId: real.seedProduct.id } });

  const testPh = await prisma.pharmacist.create({ data: { name: "약사" } });
  const t = {
    pharmacist: testPh,
    commerceProduct: await prisma.product.create({ data: { pharmacistId: testPh.id, name: "비타민C", price: 12000 } }),
    chatProduct: await prisma.product.create({ data: { pharmacistId: 1, name: "비타민C 테스트", price: 5000 } }),
    structuredProduct: await prisma.product.create({ data: { pharmacistId: 1, name: `구조화테스트_${TS} 정`, price: 1000 } }),
    customer: await anonymous(`o-${TS}-1`),
    orphanCustomer: await prisma.customer.create({ data: {} }),
    skill: await prisma.consultationSkill.create({ data: { name: `dryrun-${TS}`, description: "d", body: "b" } }),
    rbDoc: await prisma.knowledgeDocument.create({ data: { title: `rb-doc-${TS}`, body: "본문 v1" } }),
    mockedDoc: await prisma.knowledgeDocument.create({ data: { title: "루테인", body: "눈 건강" } }),
    category: await prisma.knowledgeCategory.create({ data: { name: "Z카테" } }),
  };
  const tChunks = [
    await chunk("test-model", { documentId: t.mockedDoc.id }),
    await chunk("test-model", { kind: "product", refId: "1" }),
  ];
  const cart = await prisma.cart.create({ data: { customerId: t.customer.id } });
  await prisma.cartItem.create({ data: { cartId: cart.id, productId: t.commerceProduct.id } });
  const order = await prisma.order.create({
    data: {
      orderNumber: `ORD-TEST-${TS}`, customerId: t.customer.id, subtotal: 12000, total: 12000, recipient: "r", phone: "010", address: "a",
      items: { create: { productId: t.commerceProduct.id, productName: "비타민C", unitPrice: 12000, quantity: 1, lineTotal: 12000 } },
    },
  });
  await prisma.healthProfile.create({ data: { customerId: t.customer.id } });
  const tConsult = await prisma.consultation.create({ data: { sessionId: `chat-${TS}` } });
  await prisma.message.create({ data: { consultationId: tConsult.id, role: "user", content: "피곤해요" } });
  await prisma.recommendation.create({ data: { consultationId: tConsult.id, productId: t.chatProduct.id } });
  // 실제 상담이 오염된 검색 결과로 테스트 제품을 추천한 경우: 추천 행만 지우고 상담은 남긴다
  const pollutedRec = await prisma.recommendation.create({ data: { consultationId: realConsult.id, productId: t.commerceProduct.id } });
  const tRevision = await prisma.revision.create({ data: { entityType: "skill", entityId: String(t.skill.id), snapshot: "{}" } });
  const realRevision = await prisma.revision.create({ data: { entityType: "skill", entityId: String(real.skill.id), snapshot: "{}", summary: "수정" } });
  return { real, realChunk, realConsult, realRec, realRevision, t, tChunks, order, tConsult, pollutedRec, tRevision };
}

beforeEach(async () => {
  await prisma.recommendation.deleteMany();
  await prisma.message.deleteMany();
  await prisma.consultation.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.healthProfile.deleteMany();
  await prisma.identity.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.revision.deleteMany();
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.consultationSkill.deleteMany();
  await prisma.knowledgeCategory.deleteMany({ where: { name: { not: "미분류" } } });
});

describe("TEST_SESSION_RE", () => {
  it("web/tests가 만드는 세션 ID만 맞춘다", () => {
    for (const s of [`adm-${TS}-11`, `lst-${TS}-r`, `pc-${TS}-2`, `pz2-${TS}`, `sess-merge-${TS}`, `cart-api-${TS}`, `chat-${TS}`])
      expect(TEST_SESSION_RE.test(s), s).toBe(true);
    for (const s of ["6f1c2a9e-3b7d-4e21-9c0a-1d2e3f4a5b6c", "dev-limit-d9afbc", `o-123`, `sess-x-${TS}`])
      expect(TEST_SESSION_RE.test(s), s).toBe(false);
  });
});

describe("planCleanup (dry-run)", () => {
  it("테스트 패턴 데이터만 대상으로 잡고 아무것도 지우지 않는다", async () => {
    const s = await seedMixed();
    const before = await prisma.product.count();
    const plan = await planCleanup(prisma);

    expect(plan.ids.product).toEqual(expect.arrayContaining([s.t.commerceProduct.id, s.t.chatProduct.id, s.t.structuredProduct.id]));
    expect(plan.ids.product).not.toContain(s.real.seedProduct.id);
    expect(plan.ids.product).not.toContain(s.real.mfdsProduct.id);
    expect(plan.ids.pharmacist).toContain(s.t.pharmacist.id);
    expect(plan.ids.pharmacist).not.toContain(1);
    expect(plan.ids.customer).toEqual(expect.arrayContaining([s.t.customer.id, s.t.orphanCustomer.id]));
    expect(plan.ids.customer).not.toContain(s.real.customer.id);
    expect(plan.ids.consultation).toContain(s.tConsult.id);
    expect(plan.ids.consultation).not.toContain(s.realConsult.id);
    expect(plan.ids.recommendation).toContain(s.pollutedRec.id);
    expect(plan.ids.recommendation).not.toContain(s.realRec.id);
    expect(plan.ids.order).toContain(s.order.id);
    expect(plan.ids.consultationSkill).toContain(s.t.skill.id);
    expect(plan.ids.consultationSkill).not.toContain(s.real.skill.id);
    expect(plan.ids.knowledgeDocument).toEqual(expect.arrayContaining([s.t.rbDoc.id, s.t.mockedDoc.id]));
    expect(plan.ids.knowledgeDocument).not.toContain(s.real.doc.id);
    expect(plan.ids.knowledgeChunk).toEqual(expect.arrayContaining(s.tChunks.map((c) => c.id)));
    expect(plan.ids.knowledgeChunk).not.toContain(s.realChunk.id);
    expect(plan.ids.knowledgeCategory).toContain(s.t.category.id);
    expect(plan.ids.knowledgeCategory).not.toContain(s.real.category.id);
    expect(plan.ids.revision).toContain(s.tRevision.id);
    expect(plan.ids.revision).not.toContain(s.realRevision.id);

    expect(await prisma.product.count()).toBe(before);
  });

  it("실제 주문에 들어간 테스트 제품은 남기고 이유를 기록한다", async () => {
    const s = await seedMixed();
    await prisma.order.create({
      data: {
        orderNumber: `ORD-REAL-${TS}`, customerId: s.real.customer.id, subtotal: 5000, total: 5000, recipient: "r", phone: "010", address: "a",
        items: { create: { productId: s.t.chatProduct.id, productName: "비타민C 테스트", unitPrice: 5000, quantity: 1, lineTotal: 5000 } },
      },
    });
    const plan = await planCleanup(prisma);
    expect(plan.ids.product).not.toContain(s.t.chatProduct.id);
    expect(plan.keptProducts).toContainEqual({ id: s.t.chatProduct.id, reason: expect.stringContaining("주문") });
  });

  it("테스트가 남긴 persona 설정과 그 revision을 잡는다", async () => {
    await prisma.agentSetting.upsert({ where: { key: "persona" }, update: { value: "페르소나 v2" }, create: { key: "persona", value: "페르소나 v2" } });
    // rollback.test.ts는 setAgentSettings로 기록하므로 summary가 "수정"이다
    const rev = await prisma.revision.create({ data: { entityType: "agentSetting", entityId: "persona", snapshot: JSON.stringify({ value: "페르소나 v1" }), summary: "수정" } });
    const realRev = await prisma.revision.create({ data: { entityType: "agentSetting", entityId: "persona", snapshot: JSON.stringify({ value: "친절한 약사" }), summary: "수정" } });
    const plan = await planCleanup(prisma);
    expect(plan.ids.agentSetting).toEqual(["persona"]);
    expect(plan.ids.revision).toContain(rev.id);
    expect(plan.ids.revision).not.toContain(realRev.id);
    await prisma.agentSetting.delete({ where: { key: "persona" } });
  });

  it("summary 없이 직접 기록한 skill·agentSetting revision은 테스트가 만든 것이다", async () => {
    // 실제 코드(skills.ts, agentConfig.ts)는 항상 summary("생성"/"수정")를 남긴다. revisions.test.ts는 남기지 않는다.
    const skillRev = await prisma.revision.create({ data: { entityType: "skill", entityId: "1", snapshot: JSON.stringify({ body: "v1" }) } });
    const personaRev = await prisma.revision.create({ data: { entityType: "agentSetting", entityId: "persona", snapshot: JSON.stringify({ value: "약사 페르소나" }) } });
    // 지식문서 수정(knowledgeAdmin.updateDocument)은 실제로도 summary가 없으므로 이 규칙에서 뺀다
    const docRev = await prisma.revision.create({ data: { entityType: "knowledgeDocument", entityId: "1", snapshot: "{}" } });
    const plan = await planCleanup(prisma);
    expect(plan.ids.revision).toEqual(expect.arrayContaining([skillRev.id, personaRev.id]));
    expect(plan.ids.revision).not.toContain(docRev.id);
  });
});

describe("applyCleanup (--apply)", () => {
  it("대상만 FK 순서대로 지우고 실제 데이터는 남긴다", async () => {
    const s = await seedMixed();
    const plan = await planCleanup(prisma);
    const deleted = await applyCleanup(prisma, plan);

    expect(deleted.product).toBe(plan.ids.product.length);
    expect(await prisma.product.findMany({ where: { id: { in: plan.ids.product } } })).toEqual([]);
    expect(await prisma.customer.findUnique({ where: { id: s.t.customer.id } })).toBeNull();
    expect(await prisma.pharmacist.findUnique({ where: { id: s.t.pharmacist.id } })).toBeNull();
    expect(await prisma.knowledgeDocument.findUnique({ where: { id: s.t.mockedDoc.id } })).toBeNull();
    expect(await prisma.recommendation.findUnique({ where: { id: s.pollutedRec.id } })).toBeNull();

    expect(await prisma.product.findUnique({ where: { id: s.real.seedProduct.id } })).not.toBeNull();
    expect(await prisma.product.findUnique({ where: { id: s.real.mfdsProduct.id } })).not.toBeNull();
    expect(await prisma.pharmacist.findUnique({ where: { id: 1 } })).not.toBeNull();
    expect(await prisma.customer.findUnique({ where: { id: s.real.customer.id } })).not.toBeNull();
    expect(await prisma.consultation.findUnique({ where: { id: s.realConsult.id } })).not.toBeNull();
    expect(await prisma.recommendation.findUnique({ where: { id: s.realRec.id } })).not.toBeNull();
    expect(await prisma.consultationSkill.findUnique({ where: { id: s.real.skill.id } })).not.toBeNull();
    expect(await prisma.knowledgeChunk.findUnique({ where: { id: s.realChunk.id } })).not.toBeNull();
    expect(await prisma.knowledgeCategory.findUnique({ where: { id: s.real.category.id } })).not.toBeNull();
    expect(await prisma.revision.findUnique({ where: { id: s.realRevision.id } })).not.toBeNull();

    // 다시 계획하면 남은 대상이 없다
    const again = await planCleanup(prisma);
    expect(Object.values(again.ids).every((ids) => ids.length === 0)).toBe(true);
  });
});
