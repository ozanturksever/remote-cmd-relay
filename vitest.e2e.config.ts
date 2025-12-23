import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    environment: "node",
    testTimeout: 180000, // 3 minutes for e2e tests
    hookTimeout: 180000,
  },
});
