import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@/lib": path.resolve(__dirname, "lib"),
      "@/services": path.resolve(__dirname, "services"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist", "apps", "packages"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    restoreMocks: true,
    sequence: { shuffle: false },
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "routes/**/*.ts"],
      exclude: ["**/*.test.ts", "**/__tests__/**"],
    },
  },
});
