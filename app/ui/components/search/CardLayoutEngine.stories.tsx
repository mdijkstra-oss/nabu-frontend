import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"
import { withSize } from "../../../../.storybook/decorators"
import { CardLayoutEngine } from "./CardLayoutEngine"
import type { RunGroup } from "./cards"

const groups: RunGroup[] = Array.from({ length: 5 }, (_, i) => ({
  file: `note_${i}.md`,
  hits: [{ file: `note_${i}.md`, text: `Card ${i} body` }],
}))

const renderCard = (group: RunGroup) => (
  <div className="h-full w-full rounded-xl border border-solid border-neutral-300 bg-default-background p-4">
    {group.hits[0]?.text}
  </div>
)

const meta: Meta<typeof CardLayoutEngine> = {
  title: "Custom/Search/CardLayoutEngine",
  component: CardLayoutEngine,
  decorators: [withSize({ width: "640px", height: "480px" })],
  args: {
    groups,
    renderCard,
    onBandChange: fn(),
  },
}

export default meta
type Story = StoryObj<typeof CardLayoutEngine>

export const Stacked: Story = {
  args: {
    mode: "stacked",
  },
  play: async ({ canvas }) => {
    await waitFor(() => {
      expect(canvas.getByText("Card 0 body")).toBeVisible()
      expect(canvas.getByText("Card 1 body")).toBeInTheDocument()
    })
  },
}

export const Flat: Story = {
  args: {
    mode: "flat",
  },
  play: async ({ canvas }) => {
    for (const group of groups) {
      await expect(canvas.getByText(group.hits[0]?.text ?? "")).toBeInTheDocument()
    }
  },
}

export const ArrowDownInert: Story = {
  args: {
    mode: "stacked",
  },
  play: async ({ args }) => {
    await waitFor(() => expect(args.onBandChange).toHaveBeenCalledWith({ current: 0, total: 5 }))
    await userEvent.keyboard("{ArrowDown}")
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(args.onBandChange).not.toHaveBeenCalledWith(expect.objectContaining({ current: 1 }))
  },
}

export const ArrowDownAdvances: Story = {
  args: {
    mode: "stacked",
    keyboardNav: true,
  },
  play: async ({ args }) => {
    await waitFor(() => expect(args.onBandChange).toHaveBeenCalledWith({ current: 0, total: 5 }))
    await userEvent.keyboard("{ArrowDown}")
    await waitFor(() => expect(args.onBandChange).toHaveBeenCalledWith({ current: 1, total: 5 }))
  },
}
