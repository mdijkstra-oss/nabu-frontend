import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import { withSize } from "../../../.storybook/decorators"
import { AlertDialog } from "./AlertDialog"

const entries = [
  { title: "Interview transcripts", description: "12 coded passages will be removed" },
  { title: "Field notes", description: "3 annotations will be removed" },
]

const meta: Meta<typeof AlertDialog> = {
  title: "Custom/Primitives/AlertDialog",
  component: AlertDialog,
  args: {
    title: "Delete documents?",
    description: "This cannot be undone.",
    entries,
    destructiveLabel: "Delete documents",
    onDestructive: fn(),
    onCancel: fn(),
  },
  decorators: [withSize({ height: "480px", className: "relative" })],
}

export default meta
type Story = StoryObj<typeof AlertDialog>

export const DestructiveFiresCallback: Story = {
  play: async ({ args, canvas }) => {
    for (const entry of entries) {
      expect(canvas.getByText(entry.title)).toBeInTheDocument()
      expect(canvas.getByText(entry.description)).toBeInTheDocument()
    }

    await userEvent.click(canvas.getByRole("button", { name: "Delete documents" }))
    expect(args.onDestructive).toHaveBeenCalledOnce()
    expect(args.onCancel).not.toHaveBeenCalled()
  },
}

export const KeyboardReachesBothButtons: Story = {
  play: async ({ canvas }) => {
    const cancel = canvas.getByRole("button", { name: "Cancel" })
    const destructive = canvas.getByRole("button", { name: "Delete documents" })

    await userEvent.tab()
    expect(document.activeElement).toBe(cancel)

    await userEvent.tab()
    expect(document.activeElement).toBe(destructive)
  },
}
