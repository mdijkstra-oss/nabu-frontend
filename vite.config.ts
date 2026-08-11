import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

const isStorybook = process.argv[1]?.includes("storybook")
const isVitest = Boolean(process.env.VITEST)

export default defineConfig({
  // Backends are told to allow http://localhost:5173 and nothing else, so
  // stepping to the next free port would serve the app from an origin every
  // one of them rejects. Storybook and vitest run their own servers.
  server: isStorybook || isVitest ? undefined : { strictPort: true },
  plugins: [tailwindcss(), !isStorybook && !isVitest && reactRouter(), tsconfigPaths()].filter(
    Boolean
  ),
})
