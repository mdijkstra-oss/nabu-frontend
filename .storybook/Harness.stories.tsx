import type { Meta, StoryObj } from "@storybook/react-vite"

const HarnessProbe = ({ label }: { label: string }) => <p>{label}</p>

const meta: Meta<typeof HarnessProbe> = {
  title: "Custom/Harness/HarnessProbe",
  component: HarnessProbe,
}

export default meta
type Story = StoryObj<typeof HarnessProbe>

export const Default: Story = {
  args: { label: "harness up" },
}
