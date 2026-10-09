import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";

// 테스트가 개발 DB(dev.db)에 쓰면 상담 검색 결과가 테스트 제품으로 부푼다(PINAPHARM-17)
describe("테스트 DB 격리", () => {
  it("DATABASE_URL이 test.db를 가리킨다", () => {
    expect(process.env.DATABASE_URL).toBe("file:./test.db");
  });

  it("Prisma가 실제로 연 파일이 prisma/test.db다", async () => {
    const rows = await prisma.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    const main = rows.find((r) => r.name === "main");
    expect(main?.file).toMatch(/[\\/]prisma[\\/]test\.db$/);
  });
});
