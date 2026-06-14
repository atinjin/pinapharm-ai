import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { getOrCreateConsultation, appendMessage, saveRecommendations } from "@/lib/consultations";

describe("consultation 적재", () => {
  beforeAll(async () => {
    await prisma.pharmacist.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: "김약사" } });
  });

  it("같은 session_id는 같은 consultation을 재사용한다", async () => {
    const s = "sess-c-" + Date.now();
    const cid = await resolveCustomer(s);
    const a = await getOrCreateConsultation(s, cid);
    const b = await getOrCreateConsultation(s, cid);
    expect(a).toBe(b);
  });

  it("메시지를 적재한다", async () => {
    const s = "sess-m-" + Date.now();
    const cid = await resolveCustomer(s);
    const con = await getOrCreateConsultation(s, cid);
    await appendMessage(con, "user", "피곤해요");
    await appendMessage(con, "assistant", "비타민C를 추천드려요");
    const count = await prisma.message.count({ where: { consultationId: con } });
    expect(count).toBe(2);
  });

  it("추천은 중복 없이 저장한다", async () => {
    const s = "sess-r-" + Date.now();
    const cid = await resolveCustomer(s);
    const con = await getOrCreateConsultation(s, cid);
    const p = await prisma.product.create({ data: { name: "테스트제품", price: 1000, pharmacistId: 1 } });
    await saveRecommendations(con, [p.id, p.id]);
    const count = await prisma.recommendation.count({ where: { consultationId: con } });
    expect(count).toBe(1);
  });
});
