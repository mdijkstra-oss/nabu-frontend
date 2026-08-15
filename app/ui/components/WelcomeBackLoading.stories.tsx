import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"
import { withSize } from "../../../.storybook/decorators"
import { WelcomeBackLoading } from "./WelcomeBackLoading"

const meta: Meta<typeof WelcomeBackLoading> = {
  title: "Custom/Primitives/WelcomeBackLoading",
  component: WelcomeBackLoading,
  decorators: [withSize({ height: "480px" })],
}

export default meta
type Story = StoryObj<typeof WelcomeBackLoading>

const labelStory = (progress: number, statusLabel: string): Story => ({
  args: { progress, statusLabel },
  play: async ({ canvas }) => {
    expect(canvas.getByText(statusLabel)).toBeInTheDocument()
  },
})

export const LoadingFiles: Story = labelStory(22, "Loading files...")

export const ReadingLines: Story = labelStory(74, "Reading between the lines...")

export const StructuringChaos: Story = labelStory(94, "Structuring chaos...")

export const Finalizing: Story = labelStory(100, "Finalizing...")

// One line at a time: a step never renders beside another.
export const OneLineOnly: Story = {
  args: { progress: 74, statusLabel: "Reading between the lines..." },
  play: async ({ canvas, canvasElement }) => {
    expect(canvas.getByText("Reading between the lines...")).toBeInTheDocument()
    expect(canvas.queryByText("Sorting the pile...")).toBeNull()
    expect(canvasElement.querySelectorAll("span")).toHaveLength(3)
  },
}

// An empty label leaves the bar alone rather than reserving a blank line.
export const NoLabel: Story = {
  args: { progress: 70, statusLabel: "" },
  play: async ({ canvas }) => {
    expect(canvas.getByText("Welcome back")).toBeInTheDocument()
    expect(canvas.queryByText("Reading between the lines...")).toBeNull()
  },
}
