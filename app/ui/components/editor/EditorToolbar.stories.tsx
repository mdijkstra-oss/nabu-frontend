import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { Bold, Code2, Italic, Quote } from "lucide-react"
import { EditorToolbar } from "./EditorToolbar"

const meta: Meta<typeof EditorToolbar> = {
  title: "Custom/Editor/EditorToolbar",
  component: EditorToolbar,
}

export default meta
type Story = StoryObj<typeof EditorToolbar>

const onBoldClick = fn()

export const Groups: Story = {
  args: {
    groups: [
      [
        { icon: <Bold />, onClick: onBoldClick },
        { icon: <Italic />, active: true },
      ],
      [{ icon: <Code2 />, disabled: true }, { icon: <Quote /> }],
    ],
  },
  play: async ({ canvasElement }) => {
    const buttons = within(canvasElement).getAllByRole("button")
    expect(buttons).toHaveLength(4)

    const dividers = canvasElement.querySelectorAll(".w-px.bg-neutral-border")
    expect(dividers).toHaveLength(1)

    expect(buttons[2]).toBeDisabled()

    await userEvent.click(buttons[0])
    expect(onBoldClick).toHaveBeenCalledOnce()
  },
}
