import { prisma } from "@/lib/prisma";

export async function getOrCreateConsultation(sessionId: string, customerId: number): Promise<number> {
  const existing = await prisma.consultation.findFirst({
    where: { sessionId },
    orderBy: { id: "desc" },
  });
  if (existing) return existing.id;
  const c = await prisma.consultation.create({ data: { sessionId, customerId } });
  return c.id;
}

export async function appendMessage(consultationId: number, role: string, content: string) {
  return prisma.message.create({ data: { consultationId, role, content } });
}

export async function saveRecommendations(consultationId: number, productIds: number[]) {
  for (const productId of productIds) {
    const exists = await prisma.recommendation.findFirst({ where: { consultationId, productId } });
    if (!exists) await prisma.recommendation.create({ data: { consultationId, productId } });
  }
}
