import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { withSize } from "../../../../.storybook/decorators"
import { SidebarHeader } from "./SidebarHeader"

const meta: Meta<typeof SidebarHeader> = {
  title: "Custom/Sidebar/SidebarHeader",
  component: SidebarHeader,
  parameters: {
    layout: "padded",
  },
  decorators: [withSize({ width: "280px" })],
}

export default meta
type Story = StoryObj<typeof SidebarHeader>

export const WithNewButton: Story = {
  args: {
    title: "Documents",
    filterPlaceholder: "Filter documents...",
    filterValue: "",
    onFilterChange: fn(),
    onNew: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const plusIcon = canvasElement.querySelector("svg.lucide-plus")
    expect(plusIcon).not.toBeNull()
    const button = plusIcon?.closest("button")
    expect(button).not.toBeNull()
    if (button) await userEvent.click(button)
    expect(args.onNew).toHaveBeenCalledTimes(1)
  },
}

export const WithoutNewButton: Story = {
  args: {
    title: "Documents",
    filterPlaceholder: "Filter documents...",
    filterValue: "",
    onFilterChange: fn(),
  },
  play: async ({ canvasElement, args }) => {
    expect(canvasElement.querySelector("svg.lucide-plus")).toBeNull()
    expect(canvasElement.querySelector("svg.lucide-x")).toBeNull()
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByPlaceholderText("Filter documents..."), "abc")
    expect(args.onFilterChange).toHaveBeenCalledTimes(3)
    expect(args.onFilterChange).toHaveBeenNthCalledWith(1, "a")
    expect(args.onFilterChange).toHaveBeenNthCalledWith(2, "b")
    expect(args.onFilterChange).toHaveBeenNthCalledWith(3, "c")
  },
}

export const FilledFilter: Story = {
  args: {
    title: "Documents",
    filterPlaceholder: "Filter documents...",
    filterValue: "habitat",
    onFilterChange: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByPlaceholderText("Filter documents...")).toHaveValue("habitat")
    const clearIcon = canvasElement.querySelector("svg.lucide-x")
    expect(clearIcon).not.toBeNull()
    const clearButton = clearIcon?.closest("button")
    expect(clearButton).not.toBeNull()
    if (clearButton) await userEvent.click(clearButton)
    expect(args.onFilterChange).toHaveBeenCalledWith("")
  },
}
