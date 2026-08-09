import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"
import { StatusBar } from "./StatusBar"

const meta: Meta<typeof StatusBar> = {
  title: "Custom/Primitives/StatusBar",
  component: StatusBar,
}

export default meta
type Story = StoryObj<typeof StatusBar>

export const TextOnly: Story = {
  args: { text: "3 documents indexed" },
}

export const Loading: Story = {
  args: { text: "Indexing documents...", loading: true },
}

export const WithTooltip: Story = {
  args: { text: "3 documents indexed", tooltip: "Last indexed 2 minutes ago" },
}

export const NullTextRendersNothing: Story = {
  args: { text: null },
  play: async ({ canvasElement }) => {
    expect(canvasElement).toBeEmptyDOMElement()
  },
}
