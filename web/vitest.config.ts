import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    // 개발 DB(dev.db)를 건드리지 않도록 별도 test.db를 쓴다. process.env가 .env보다 우선한다.
    env: { DATABASE_URL: "file:./test.db" },
    globalSetup: ["tests/global-setup.ts"],
  },
});
