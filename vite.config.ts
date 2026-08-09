import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const isStorybook = process.argv[1]?.includes("storybook");
const isVitest = Boolean(process.env.VITEST);

export default defineConfig({
  plugins: [
    tailwindcss(),
    !isStorybook && !isVitest && reactRouter(),
    tsconfigPaths(),
  ].filter(Boolean),
});
