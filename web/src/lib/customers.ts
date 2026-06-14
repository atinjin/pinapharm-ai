import { prisma } from "@/lib/prisma";
import { parseTags, stringifyTags } from "@/lib/products";

export async function resolveCustomer(sessionId: string): Promise<number> {
  const found = await prisma.identity.findUnique({
    where: {
      provider_providerAccountId: { provider: "anonymous", providerAccountId: sessionId },
    },
  });
  if (found) return found.customerId;
  const customer = await prisma.customer.create({
    data: { identities: { create: { provider: "anonymous", providerAccountId: sessionId } } },
  });
  return customer.id;
}

export type HealthProfileInput = {
  ageBand?: string;
  sex?: string;
  conditions?: string[];
  medications?: string[];
  allergies?: string[];
  pregnancy?: string;
  notes?: string;
};

export type HealthProfileView = {
  ageBand: string | null;
  sex: string | null;
  conditions: string[];
  medications: string[];
  allergies: string[];
  pregnancy: string | null;
  notes: string | null;
};

function unionTags(existing: string, incoming?: string[]): string {
  if (!incoming || incoming.length === 0) return existing;
  const merged = Array.from(new Set([...parseTags(existing), ...incoming.map(String)]));
  return stringifyTags(merged);
}

export async function getHealthProfile(customerId: number): Promise<HealthProfileView> {
  const p = await prisma.healthProfile.findUnique({ where: { customerId } });
  return {
    ageBand: p?.ageBand ?? null,
    sex: p?.sex ?? null,
    conditions: p ? parseTags(p.conditions) : [],
    medications: p ? parseTags(p.medications) : [],
    allergies: p ? parseTags(p.allergies) : [],
    pregnancy: p?.pregnancy ?? null,
    notes: p?.notes ?? null,
  };
}

export async function saveHealthProfile(
  customerId: number,
  input: HealthProfileInput
): Promise<HealthProfileView> {
  const existing = await prisma.healthProfile.findUnique({ where: { customerId } });
  const data = {
    ageBand: input.ageBand ?? existing?.ageBand ?? null,
    sex: input.sex ?? existing?.sex ?? null,
    pregnancy: input.pregnancy ?? existing?.pregnancy ?? null,
    notes: input.notes ?? existing?.notes ?? null,
    conditions: unionTags(existing?.conditions ?? "[]", input.conditions),
    medications: unionTags(existing?.medications ?? "[]", input.medications),
    allergies: unionTags(existing?.allergies ?? "[]", input.allergies),
  };
  await prisma.healthProfile.upsert({
    where: { customerId },
    create: { customerId, ...data },
    update: data,
  });
  return getHealthProfile(customerId);
}
