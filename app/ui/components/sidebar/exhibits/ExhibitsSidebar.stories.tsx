import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import type { ExhibitItem } from "~/domain/exhibits/types"
import { withSize } from "../../../../../.storybook/decorators"
import { docTitle } from "../documents/fixtures"
import { ExhibitsSidebar } from "./ExhibitsSidebar"

const sampleExhibits: ExhibitItem[] = [
  {
    id: "e1",
    title: "Deforestation by Region",
    kind: "chart",
    subtype: "bar",
    documentId: "1",
    documentTitle: docTitle("1"),
  },
  {
    id: "e2",
    title: "Species Decline Over Time",
    kind: "chart",
    subtype: "line",
    documentId: "3",
    documentTitle: docTitle("3"),
  },
  {
    id: "e3",
    title: "Land Use Share",
    kind: "chart",
    subtype: "pie",
    documentId: "5",
    documentTitle: docTitle("5"),
  },
  {
    id: "e4",
    title: "Rainfall vs Canopy Cover",
    kind: "chart",
    subtype: "scatter",
    documentId: "3",
    documentTitle: docTitle("3"),
  },
]

const meta: Meta<typeof ExhibitsSidebar> = {
  title: "Custom/Sidebar/Exhibits/ExhibitsSidebar",
  component: ExhibitsSidebar,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withSize({ height: "100vh" })],
}

export default meta
type Story = StoryObj<typeof ExhibitsSidebar>

export const Grouped: Story = {
  args: {
    exhibits: sampleExhibits,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText("Charts")).toBeInTheDocument()
    expect(canvas.getByText("4")).toBeInTheDocument()
    expect(canvas.queryByText("Deforestation by Region")).toBeNull()
  },
}

export const Searching: Story = {
  args: {
    exhibits: sampleExhibits,
    searchValue: "species",
    onExhibitSelect: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const matching = await canvas.findByText("Species Decline Over Time")
    expect(canvas.getByText("Land Use Share")).toBeInTheDocument()
    expect(canvas.queryByText("Charts")).toBeNull()
    expect(canvas.queryByText("Deforestation by Region")).toBeNull()
    await userEvent.click(matching)
    expect(args.onExhibitSelect).toHaveBeenCalledTimes(1)
    expect(args.onExhibitSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "e2" }))
  },
}

export const FlyOut: Story = {
  args: {
    exhibits: sampleExhibits,
    onExhibitSelect: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.hover(canvas.getByText("Charts"))
    await waitFor(() => {
      expect(canvas.getAllByText("Charts")).toHaveLength(2)
      expect(canvas.getByText("Land Use Share")).toBeInTheDocument()
    })
    await userEvent.click(canvas.getByText("Land Use Share"))
    expect(args.onExhibitSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "e3" }))
  },
}
