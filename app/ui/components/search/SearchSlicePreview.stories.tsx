import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, waitFor } from "storybook/test"
import { withRouter, withSeededFiles } from "../../../../.storybook/decorators"
import { SearchSlicePreview } from "./cards"

const meta: Meta<typeof SearchSlicePreview> = {
  title: "Custom/Search/SearchSlicePreview",
  component: SearchSlicePreview,
  decorators: [
    withSeededFiles({ "field_notes.md": "# Field notes\n\nThe river rose overnight." }),
    withRouter(),
    (Story) => (
      <div style={{ width: 560 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    text: "The river rose overnight. The crossing at the ford was impassable until noon.",
    filePath: "field_notes.md",
    spotlights: null,
    onNavigate: fn(),
  },
}

export default meta
type Story = StoryObj<typeof SearchSlicePreview>

export const WithDebugChrome: Story = {
  args: {
    debug: {
      score: 0.8123,
      matchRanges: [
        { confidence: "clear", reasonToKeep: "direct mention of the flood" },
        { confidence: "borderline" },
      ],
      showRawText: true,
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/score: 0\.8123/)).toBeInTheDocument()
    await expect(canvas.getByText("clear")).toBeInTheDocument()
    await expect(canvas.getByText("borderline")).toBeInTheDocument()
    await expect(canvas.getByText("direct mention of the flood")).toBeInTheDocument()
  },
}

export const WithoutDebug: Story = {
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() => expect(canvas.getByText(/impassable until noon/)).toBeInTheDocument())
    expect(canvas.queryByText(/score:/)).toBeNull()
    expect(canvas.queryByText("clear")).toBeNull()
    expect(canvasElement.querySelector("pre")).toBeNull()
  },
}

export const WithoutNavigate: Story = {
  args: {
    onNavigate: undefined,
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector(".lucide-locate-fixed")).toBeNull()
  },
}
