import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"
import { withRouter, withSeededFiles, withSize } from "../../../../.storybook/decorators"
import { RunGroupCard } from "./cards"
import { detailHits, tagDefinitions } from "./fixtures"

const meta: Meta<typeof RunGroupCard> = {
  title: "Custom/Search/RunGroupCard",
  component: RunGroupCard,
  decorators: [
    withSeededFiles({ "field_notes.md": "# Field notes\n\nThe river rose overnight." }),
    withRouter(),
    withSize({ width: "640px" }),
  ],
  args: {
    title: "Field Notes",
    date: "2024-03-14",
    tags: tagDefinitions,
    hits: detailHits,
    hitCount: 3,
    onOpenFile: fn(),
    onNavigateHit: fn(),
  },
}

export default meta
type Story = StoryObj<typeof RunGroupCard>

export const ThreeHits: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("3 hits")).toBeInTheDocument()
    await waitFor(() => {
      expect(canvas.getByText(/impassable until noon/)).toBeInTheDocument()
      expect(canvas.getByText(/settled back into its banks/)).toBeInTheDocument()
      expect(canvas.getByText(/exposed sandbars/)).toBeInTheDocument()
    })
    await userEvent.click(canvas.getByRole("button", { name: "Field Notes" }))
    expect(args.onOpenFile).toHaveBeenCalledOnce()
  },
}

// The group-level debug object carries no score; each line proves the card
// merged the hit's own score fields before forwarding to the slice.
export const DebugScoresPerSlice: Story = {
  args: {
    debug: { showRawText: false },
  },
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() => {
      expect(canvas.getByText(/score: 0\.8123/)).toBeInTheDocument()
      expect(canvas.getByText(/score: 0\.6521/)).toBeInTheDocument()
      expect(canvas.getByText(/score: 0\.6017/)).toBeInTheDocument()
    })
    expect(canvasElement.querySelector("pre")).toBeNull()
  },
}
