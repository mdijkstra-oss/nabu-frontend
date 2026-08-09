import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { SearchCodeButton } from "./CodesSidebar"
import { sampleCode } from "./fixtures"

const meta: Meta<typeof SearchCodeButton> = {
  title: "Custom/Sidebar/Codes/SearchCodeButton",
  component: SearchCodeButton,
  parameters: {
    layout: "padded",
  },
}

export default meta
type Story = StoryObj<typeof SearchCodeButton>

export const ZeroCount: Story = {
  args: {
    code: sampleCode,
    onClick: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole("button")
    expect(button).toBeDisabled()
    expect(canvas.getByText("0")).toBeInTheDocument()
  },
}

export const WithAnnotations: Story = {
  args: {
    code: sampleCode,
    globalCount: { count: 12, fileCount: 3 },
    onClick: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole("button")
    expect(button).not.toBeDisabled()
    expect(canvas.getByText("12")).toBeInTheDocument()
    await userEvent.click(button)
    expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}
