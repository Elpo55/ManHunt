import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@shared$/, replacement: resolve(import.meta.dirname, "packages/shared/src/index.ts") },
      { find: /^@shared\/(.*)$/, replacement: resolve(import.meta.dirname, "packages/shared/src/$1") },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
