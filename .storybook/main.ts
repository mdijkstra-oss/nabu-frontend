import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  "stories": [
    "../app/ui/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../app/lib/editor/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "./*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [
    "@chromatic-com/storybook",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-onboarding",
    "@storybook/addon-vitest"
  ],
  "framework": "@storybook/react-vite",
};
export default config;
