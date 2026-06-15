import { prisma } from "@/lib/prisma";

export async function listSkills() {
  return prisma.consultationSkill.findMany({ orderBy: { createdAt: "desc" } });
}

export async function listActiveSkills() {
  return prisma.consultationSkill.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getSkillByName(name: string) {
  return prisma.consultationSkill.findFirst({ where: { name, isActive: true } });
}

export async function createSkill(input: {
  name: string;
  description: string;
  body: string;
  isActive?: boolean;
}) {
  return prisma.consultationSkill.create({ data: input });
}

export async function updateSkill(
  id: number,
  input: {
    name?: string;
    description?: string;
    body?: string;
    isActive?: boolean;
  }
) {
  return prisma.consultationSkill.update({ where: { id }, data: input });
}

export async function deleteSkill(id: number) {
  return prisma.consultationSkill.delete({ where: { id } });
}
