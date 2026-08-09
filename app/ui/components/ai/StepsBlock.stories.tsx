import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"
import { withSize } from "../../../../.storybook/decorators"
import { AbortBox } from "./StepsBlock"

const meta: Meta<typeof AbortBox> = {
  title: "Custom/Chat/AbortBox",
  component: AbortBox,
  decorators: [withSize({ width: "380px" })],
}

export default meta
type Story = StoryObj<typeof AbortBox>

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Pivoted plan")).toBeVisible()
  },
}

export const CustomMessage: Story = {
  args: {
    message: "Plan cancelled after step 2",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Plan cancelled after step 2")).toBeVisible()
    expect(canvas.queryByText("Pivoted plan")).toBeNull()
  },
}
