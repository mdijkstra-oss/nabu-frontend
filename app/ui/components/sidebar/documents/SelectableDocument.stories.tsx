import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { withSize } from "../../../../../.storybook/decorators"
import { SelectableDocument } from "./DocumentsSidebar"
import { sampleDocuments } from "./fixtures"

const meta: Meta<typeof SelectableDocument> = {
  title: "Custom/Sidebar/Documents/SelectableDocument",
  component: SelectableDocument,
  parameters: {
    layout: "padded",
  },
  decorators: [withSize({ width: "280px" })],
}

export default meta
type Story = StoryObj<typeof SelectableDocument>

const doc = sampleDocuments[0]

export const Unchecked: Story = {
  args: {
    doc,
    color: "lime",
    isCurrent: false,
    isChecked: false,
    onToggle: fn(),
    onSelect: fn(),
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector("svg.lucide-check")).toBeNull()
  },
}

export const Checked: Story = {
  args: {
    doc,
    color: "lime",
    isCurrent: false,
    isChecked: true,
    onToggle: fn(),
    onSelect: fn(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector("svg.lucide-check")).not.toBeNull()
    })
  },
}

export const Current: Story = {
  args: {
    doc,
    color: "blue",
    isCurrent: true,
    isChecked: false,
    onToggle: fn(),
    onSelect: fn(),
  },
}

export const ToggleAndSelect: Story = {
  args: {
    doc,
    color: "lime",
    isCurrent: false,
    isChecked: false,
    onToggle: fn(),
    onSelect: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByText(doc.title)
    await userEvent.hover(title)
    await userEvent.click(canvas.getByRole("button"))
    expect(args.onToggle).toHaveBeenCalledTimes(1)
    expect(args.onSelect).not.toHaveBeenCalled()
    await userEvent.click(title)
    expect(args.onSelect).toHaveBeenCalledTimes(1)
  },
}
