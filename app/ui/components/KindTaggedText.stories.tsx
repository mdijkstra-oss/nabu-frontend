import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"
import { KindTaggedText } from "./KindTaggedText"

const meta: Meta<typeof KindTaggedText> = {
  title: "Custom/KindTaggedText",
  component: KindTaggedText,
}

export default meta
type Story = StoryObj<typeof KindTaggedText>

export const PersonTitle: Story = {
  args: { text: ":person: rutte" },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("rutte")).toBeInTheDocument()
    expect(canvasElement.querySelector('[aria-label="person"] svg')).not.toBeNull()
    expect(canvasElement.textContent).not.toContain(":person:")
  },
}

export const DateTitle: Story = {
  args: { text: ":date: 2 Aug 2026" },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[aria-label="date"] svg')).not.toBeNull()
  },
}

export const UnknownTagStaysText: Story = {
  args: { text: ":nope: literal" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(":nope: literal")).toBeInTheDocument()
  },
}
