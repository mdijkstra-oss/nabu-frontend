import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"
import { BLOCK_COLORS } from "~/ui/theme/colors"
import { CalloutContent } from "./content"
import { callout } from "./fixtures"

const firstColor = BLOCK_COLORS[0]
const midColor = BLOCK_COLORS[Math.floor(BLOCK_COLORS.length / 2)]
const lastColor = BLOCK_COLORS[BLOCK_COLORS.length - 1]

const meta: Meta<typeof CalloutContent> = {
  title: "Custom/Editor/CalloutContent",
  component: CalloutContent,
  decorators: [
    (Story) => (
      <div style={{ width: 480 }} className="flex items-start gap-3">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof CalloutContent>

export const ExpandedFirstColor: Story = {
  args: { data: callout(firstColor) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText("Trust")).toBeInTheDocument()
    await waitFor(() => {
      const markdown = canvasElement.querySelector(".ProseMirror")
      expect(markdown).not.toBeNull()
      expect(markdown?.querySelector("strong")).toHaveTextContent("mutual reliance")
    })
  },
}

export const ExpandedMidColor: Story = {
  args: { data: callout(midColor) },
}

export const ExpandedLastColor: Story = {
  args: { data: callout(lastColor) },
}

export const CollapsedFirstColor: Story = {
  args: { data: callout(firstColor, { collapsed: true }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText("Trust")).toBeInTheDocument()
    expect(canvasElement.querySelector(".ProseMirror")).toBeNull()
    expect(canvas.queryByText(/mutual reliance/)).toBeNull()
  },
}

export const CollapsedMidColor: Story = {
  args: { data: callout(midColor, { collapsed: true }) },
}

export const CollapsedLastColor: Story = {
  args: { data: callout(lastColor, { collapsed: true }) },
}
