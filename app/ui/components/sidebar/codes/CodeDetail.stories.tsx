import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"
import { withSize } from "../../../../../.storybook/decorators"
import { CodeDetail } from "./CodeDetail"
import { sampleCode } from "./fixtures"

const meta: Meta<typeof CodeDetail> = {
  title: "Custom/Sidebar/Codes/CodeDetail",
  component: CodeDetail,
  parameters: {
    layout: "padded",
  },
  decorators: [withSize({ width: "320px" })],
}

export default meta
type Story = StoryObj<typeof CodeDetail>

export const Markdown: Story = {
  args: {
    code: sampleCode,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByText("Definition")
    expect(heading.tagName).toBe("SPAN")
    expect(heading.className).toContain("font-body-bold")
    const paragraph = canvas.getByText("A speaker recognizes and names another person's feelings.")
    expect(paragraph.tagName).toBe("SPAN")
    expect(canvas.getByText("Naming an emotion").closest("li")).not.toBeNull()
    expect(canvas.getByText("Mirroring back a concern").closest("li")).not.toBeNull()
  },
}
