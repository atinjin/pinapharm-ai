import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

// vitest.config.ts의 test.env와 같은 값. 경로는 schema.prisma 기준 상대 경로다.
export const TEST_DATABASE_URL = "file:./test.db";

// 매 실행마다 test.db를 지우고 마이그레이션으로 빈 스키마를 만든다.
// migrate reset 대신 파일 삭제 + migrate deploy를 쓴다: 대상이 새 파일이라 파괴적 명령이 필요 없다.
export default function setup() {
  const prismaDir = path.resolve(__dirname, "../prisma");
  for (const f of ["test.db", "test.db-journal"]) rmSync(path.join(prismaDir, f), { force: true });
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
