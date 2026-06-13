import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const pharmacist = await prisma.pharmacist.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "김약사" },
  });

  const products = [
    { name: "비타민C 1000", brand: "헬스랩", price: 18000, ingredients: "비타민C 1000mg", conditionTags: ["피로", "면역"], imageUrl: null, stock: 50, description: "피로 회복과 면역에 도움" },
    { name: "루테인 지아잔틴", brand: "아이케어", price: 25000, ingredients: "루테인 20mg", conditionTags: ["눈건강"], imageUrl: null, stock: 30, description: "눈 건강과 황반 보호" },
    { name: "마그네슘 비타민B", brand: "데일리", price: 15000, ingredients: "마그네슘 350mg", conditionTags: ["피로", "근육경련", "수면"], imageUrl: null, stock: 40, description: "근육 이완과 피로 개선" },
    { name: "오메가3", brand: "씨오일", price: 22000, ingredients: "EPA/DHA 900mg", conditionTags: ["혈행", "관절"], imageUrl: null, stock: 25, description: "혈행 개선과 관절 건강" },
    { name: "유산균 프로바이오틱스", brand: "장건강", price: 30000, ingredients: "100억 CFU", conditionTags: ["장건강", "소화"], imageUrl: null, stock: 35, description: "장 건강과 소화 개선" },
  ];

  for (const p of products) {
    await prisma.product.create({
      data: { ...p, conditionTags: JSON.stringify(p.conditionTags), pharmacistId: pharmacist.id },
    });
  }
  console.log("seeded");
}

main().finally(() => prisma.$disconnect());
