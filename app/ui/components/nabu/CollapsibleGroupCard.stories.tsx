import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, waitFor } from "storybook/test"
import { withSize } from "../../../../.storybook/decorators"
import { CollapsibleGroupCard, successTone, slateTone } from "./CollapsibleGroupCard"

const meta: Meta<typeof CollapsibleGroupCard> = {
  title: "Custom/Chat/CollapsibleGroupCard",
  component: CollapsibleGroupCard,
  decorators: [withSize({ width: "380px" })],
}

export default meta
type Story = StoryObj<typeof CollapsibleGroupCard>

export const SuccessTone: Story = {
  args: {
    tone: successTone,
    summary: "Added 3 annotations",
    children: <div>First annotation row</div>,
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    expect(canvasElement.querySelector('[class*="bg-success-100"]')).not.toBeNull()
    expect(canvas.getByText("Added 3 annotations").className).toContain("text-success-700")

    await userEvent.click(canvas.getByText("Added 3 annotations"))
    await waitFor(() => expect(canvas.getByText("First annotation row")).toBeVisible())
  },
}

export const SlateTone: Story = {
  args: {
    tone: slateTone,
    summary: "5 upcoming steps",
    children: <div>First step row</div>,
  },
  play: async ({ canvas, canvasElement }) => {
    expect(canvasElement.querySelector('[class*="bg-slate-100"]')).not.toBeNull()
    expect(canvas.getByText("5 upcoming steps").className).toContain("text-slate-700")
  },
}

export const NonExpandableSummaryClick: Story = {
  args: {
    tone: successTone,
    summary: "Updated annotation: Onboarding felt rushed",
    expandable: false,
    onSummaryClick: fn(),
    children: <div>Hidden row</div>,
  },
  play: async ({ canvas, canvasElement, args, userEvent }) => {
    expect(canvasElement.querySelector("svg.lucide-chevron-right")).toBeNull()
    await userEvent.click(canvas.getByText(/Onboarding felt rushed/))
    expect(args.onSummaryClick).toHaveBeenCalledTimes(1)
    expect(canvas.queryByText("Hidden row")).toBeNull()
  },
}
