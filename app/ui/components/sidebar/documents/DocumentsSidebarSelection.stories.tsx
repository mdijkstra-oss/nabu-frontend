import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { withSize } from "../../../../../.storybook/decorators"
import { DocumentsSidebar } from "./DocumentsSidebar"
import { sampleDocuments } from "./fixtures"

const meta: Meta<typeof DocumentsSidebar> = {
  title: "Custom/Sidebar/Documents/DocumentsSidebarSelection",
  component: DocumentsSidebar,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withSize({ height: "100vh" })],
}

export default meta
type Story = StoryObj<typeof DocumentsSidebar>

const rowOf = (element: Element): HTMLElement => {
  const row = element.closest("div.flex.w-full.items-center")
  if (!(row instanceof HTMLElement)) throw new Error("element is not inside a checkable row")
  return row
}

export const SelectionStates: Story = {
  args: {
    documents: sampleDocuments,
    selectedDocIds: new Set(["3", "5"]),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const checks = canvasElement.querySelectorAll("svg.lucide-check")
      const minuses = canvasElement.querySelectorAll("svg.lucide-minus")
      expect(checks).toHaveLength(1)
      expect(minuses).toHaveLength(1)
      expect(within(rowOf(checks[0])).getByText("Corpus")).toBeInTheDocument()
      expect(within(rowOf(minuses[0])).getByText("Ecology")).toBeInTheDocument()
    })
  },
}

export const ToggleDocFires: Story = {
  args: {
    documents: sampleDocuments,
    searchValue: "data",
    onSearchChange: fn(),
    onToggleDoc: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const title = await canvas.findByText("Species Survey Data")
    await userEvent.hover(title)
    await userEvent.click(within(rowOf(title)).getByRole("button"))
    expect(args.onToggleDoc).toHaveBeenCalledTimes(1)
    expect(args.onToggleDoc).toHaveBeenCalledWith("5")
  },
}

export const TagToggleFires: Story = {
  args: {
    documents: sampleDocuments,
    onToggleTag: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByText("Corpus"))
    expect(args.onToggleTag).toHaveBeenCalledTimes(1)
    expect(args.onToggleTag).toHaveBeenCalledWith(["3", "5"])
  },
}

export const EmptyDocuments: Story = {
  args: {
    documents: [],
    onSortChange: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText("Documents")).toBeInTheDocument()
    expect(canvas.getByText("Name")).toBeInTheDocument()
    expect(canvas.getByText("Date")).toBeInTheDocument()
    const list = canvasElement.querySelector(".overflow-y-auto")
    expect(list).not.toBeNull()
    expect(list?.childElementCount).toBe(0)
  },
}

export const FilterNoMatches: Story = {
  args: {
    documents: sampleDocuments,
    searchValue: "zzzz",
  },
  play: async ({ canvasElement }) => {
    const list = canvasElement.querySelector(".overflow-y-auto")
    expect(list).not.toBeNull()
    expect(list?.childElementCount).toBe(0)
  },
}

export const FilterTypesPerKeystroke: Story = {
  args: {
    documents: sampleDocuments,
    searchValue: "",
    onSearchChange: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByPlaceholderText("Filter documents..."), "ab")
    expect(args.onSearchChange).toHaveBeenCalledTimes(2)
    expect(args.onSearchChange).toHaveBeenNthCalledWith(1, "a")
    expect(args.onSearchChange).toHaveBeenNthCalledWith(2, "b")
  },
}

export const FilteredFlatListChecked: Story = {
  args: {
    documents: sampleDocuments,
    searchValue: "data",
    selectedDocIds: new Set(["5"]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = await canvas.findByText("Species Survey Data")
    await waitFor(() => {
      expect(rowOf(title).querySelector("svg.lucide-check")).not.toBeNull()
    })
  },
}

export const FlyOutCheckedDocs: Story = {
  args: {
    documents: sampleDocuments,
    selectedDocIds: new Set(["3"]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.hover(await canvas.findByText("Corpus"))
    await waitFor(() => {
      expect(canvas.getAllByText("Corpus")).toHaveLength(2)
      const checkedDoc = canvas.getByText("Amazon Rainforest Case Study")
      expect(rowOf(checkedDoc).querySelector("svg.lucide-check")).not.toBeNull()
      const uncheckedDoc = canvas.getByText("Species Survey Data")
      expect(rowOf(uncheckedDoc).querySelector("svg.lucide-check")).toBeNull()
    })
  },
}
