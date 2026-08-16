import { defineConfig, configDefaults } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

// Stryker's vitest runner cannot select one project out of `vitest.config.ts`, and the
// storybook project needs a browser it cannot drive. This is the unit project alone.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["app/**/*.test.{ts,tsx}"],
    exclude: [
      ...configDefaults.exclude,
      // Red before this config existed; a red baseline stops Stryker from starting.
      "app/domain/data-blocks/migrations/scenarios/scenarios.test.ts",
      // Re-imports the duckdb-wasm module graph through vi.resetModules(); the worker
      // it spawns has no workerData under Stryker's runner, so the file is red there.
      "app/domain/db/schema-stability.test.ts",
    ],
  },
})
