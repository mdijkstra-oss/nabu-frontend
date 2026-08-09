import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"
import { MarkdownContent } from "./MarkdownContent"

const meta: Meta<typeof MarkdownContent> = {
  title: "Custom/Editor/MarkdownContent",
  component: MarkdownContent,
}

export default meta
type Story = StoryObj<typeof MarkdownContent>

export const Default: Story = {
  args: {
    content: [
      "# Field Notes",
      "",
      "A paragraph with **bold** and *italic* text, plus ~~struck~~ GFM.",
      "",
      "- first item",
      "- second item",
    ].join("\n"),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const editor = canvasElement.querySelector(".ProseMirror")
      expect(editor).not.toBeNull()
      expect(editor?.querySelector("h1")).toHaveTextContent("Field Notes")
      expect(editor?.querySelector("strong")).toHaveTextContent("bold")
      expect(editor?.querySelectorAll("li")).toHaveLength(2)
    })
  },
}
