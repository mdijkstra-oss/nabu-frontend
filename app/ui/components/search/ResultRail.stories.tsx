import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import { ResultRail } from "./ResultRail"

const meta: Meta<typeof ResultRail> = {
  title: "Custom/Search/ResultRail",
  component: ResultRail,
  args: {
    onScrollTo: fn(),
    onStep: fn(),
  },
}

export default meta
type Story = StoryObj<typeof ResultRail>

export const SingleResult: Story = {
  args: {
    band: { current: 0, total: 1 },
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toBe("")
    expect(canvasElement.querySelector("button")).toBeNull()
  },
}

export const FiveResults: Story = {
  args: {
    band: { current: 0, total: 5 },
  },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("1 / 5")).toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "Next" }))
    expect(args.onStep).toHaveBeenCalledWith(1)
    await userEvent.click(canvas.getByRole("button", { name: "Previous" }))
    expect(args.onStep).toHaveBeenCalledWith(-1)
  },
}
