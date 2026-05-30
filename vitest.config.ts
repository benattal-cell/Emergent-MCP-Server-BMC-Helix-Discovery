import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist", "tests/**/*.test.js"]
  },
  resolve: {
    alias: {
      graphology: fileURLToPath(new URL("./tests/mocks/graphology.ts", import.meta.url)),
      "graphology-layout-forceatlas2": fileURLToPath(new URL("./tests/mocks/forceatlas2.ts", import.meta.url))
    }
  }
});
