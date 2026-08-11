import { defineConfig } from "vitest/config"
import { playwright } from "@vitest/browser-playwright"
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import tailwindcss from "@tailwindcss/vite"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["app/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        plugins: [tailwindcss(), storybookTest({ configDir: ".storybook" })],
        optimizeDeps: {
          include: [
            "@milkdown/kit/core",
            "@milkdown/kit/preset/commonmark",
            "@milkdown/kit/preset/gfm",
            "@milkdown/react",
            "prosemirror-model",
            "prosemirror-state",
            "prosemirror-view",
          ],
        },
        test: {
          name: "storybook",
          // Stories driving CDP (CSS.forcePseudoState) wait on CSS.enable, which reparses
          // every stylesheet in the page. Run alongside the unit project that turns a
          // sub-second story into a 17s one, past vitest's 15s default.
          testTimeout: 60_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
          setupFiles: [".storybook/vitest.setup.ts"],
        },
      },
    ],
  },
})
