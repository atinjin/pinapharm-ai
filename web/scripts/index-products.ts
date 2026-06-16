import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { indexProduct } from "../src/lib/products";

async function main() {
  const products = await prisma.product.findMany({ where: { isActive: true } });
  for (const p of products) await indexProduct(p);
  console.log(`제품 색인 완료: ${products.length}건`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
