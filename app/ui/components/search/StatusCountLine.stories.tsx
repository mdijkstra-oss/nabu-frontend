import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"
import { StatusCountLine } from "./StatusCountLine"

const meta: Meta<typeof StatusCountLine> = {
  title: "Custom/Search/StatusCountLine",
  component: StatusCountLine,
}

export default meta
type Story = StoryObj<typeof StatusCountLine>

export const Loading: Story = {
  args: {
    loading: true,
    statusText: null,
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector(".animate-spin")).not.toBeNull()
  },
}

export const WithStatus: Story = {
  args: {
    loading: false,
    statusText: "Showing 12 results across 4 files",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Showing 12 results across 4 files")).toBeInTheDocument()
  },
}

export const Empty: Story = {
  args: {
    loading: false,
    statusText: null,
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector(".animate-spin")).toBeNull()
    expect(canvasElement.textContent).toBe("")
    expect(canvasElement.firstElementChild).not.toBeNull()
  },
}
