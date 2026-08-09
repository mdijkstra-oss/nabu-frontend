import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import { withSize } from "../../../../.storybook/decorators"
import { HitRow } from "./SearchBarView"
import { stackHits, corpusHits } from "./fixtures"

const meta: Meta<typeof HitRow> = {
  title: "Custom/Search/HitRow",
  component: HitRow,
  decorators: [withSize({ width: "480px" })],
  args: {
    query: "river",
    onPick: fn(),
  },
}

export default meta
type Story = StoryObj<typeof HitRow>

export const InStack: Story = {
  args: {
    hit: stackHits[0],
    inStack: true,
  },
  play: async ({ args, canvas, canvasElement }) => {
    await expect(canvas.getByText("Field Notes")).toBeInTheDocument()
    expect(canvasElement.querySelector(".lucide-locate-fixed")).not.toBeNull()
    await userEvent.click(canvas.getByRole("button"))
    expect(args.onPick).toHaveBeenCalledOnce()
  },
}

export const Corpus: Story = {
  args: {
    hit: corpusHits[0],
    inStack: false,
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("Archive Letters")).toBeInTheDocument()
    expect(canvasElement.querySelector(".lucide-arrow-up-right")).not.toBeNull()
  },
}
