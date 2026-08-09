import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor } from "storybook/test"
import { withSize } from "../../../.storybook/decorators"
import { TextFieldUnstyled } from "./TextFieldUnstyled"

const meta: Meta<typeof TextFieldUnstyled> = {
  title: "Custom/Primitives/TextFieldUnstyled",
  component: TextFieldUnstyled,
  decorators: [
    withSize({
      width: "320px",
      className: "rounded-md border border-solid border-neutral-border px-2",
    }),
  ],
}

export default meta
type Story = StoryObj<typeof TextFieldUnstyled>

export const Input: Story = {
  render: () => (
    <TextFieldUnstyled>
      <TextFieldUnstyled.Input placeholder="Type a title" />
    </TextFieldUnstyled>
  ),
}

export const TextareaGrowsWithTyping: Story = {
  render: () => (
    <TextFieldUnstyled>
      <TextFieldUnstyled.Textarea placeholder="Type a message" />
    </TextFieldUnstyled>
  ),
  play: async ({ canvas }) => {
    const textarea = canvas.getByRole("textbox") as HTMLTextAreaElement
    expect(textarea.style.height).toBe("20px")

    await userEvent.click(textarea)
    await userEvent.type(textarea, "one{enter}two")
    await waitFor(() => expect(textarea.style.height).toBe("40px"))

    await userEvent.type(textarea, "{enter}three{enter}four{enter}five{enter}six")
    await waitFor(() => expect(textarea.style.height).toBe("80px"))
  },
}
