import { prisma } from "@/lib/prisma";
import { recordRevision } from "@/lib/revisions";

function snapshotSkill(s: { name: string; description: string; body: string; isActive: boolean }) {
  return { name: s.name, description: s.description, body: s.body, isActive: s.isActive };
}

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
  const skill = await prisma.consultationSkill.create({ data: input });
  await recordRevision("skill", String(skill.id), snapshotSkill(skill), "생성");
  return skill;
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
  const skill = await prisma.consultationSkill.update({ where: { id }, data: input });
  await recordRevision("skill", String(skill.id), snapshotSkill(skill), "수정");
  return skill;
}

export async function deleteSkill(id: number) {
  return prisma.consultationSkill.delete({ where: { id } });
}
