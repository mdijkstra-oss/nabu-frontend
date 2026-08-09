import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, waitFor } from "storybook/test"
import { withSize } from "../../../../.storybook/decorators"
import { ChatComposer } from "./ChatComposer"
import { CHAT_SIDEBAR_WIDTH } from "./fixtures"

const meta: Meta<typeof ChatComposer> = {
  title: "Custom/Chat/ChatComposer",
  component: ChatComposer,
  decorators: [withSize({ width: CHAT_SIDEBAR_WIDTH })],
  args: {
    mode: "send",
    awaitingAnswer: false,
    onSend: fn(),
    onSkipAsk: fn(),
    onCancel: fn(),
    onCancelPlan: fn(),
  },
}

export default meta
type Story = StoryObj<typeof ChatComposer>

export const SendMode: Story = {
  play: async ({ canvas, args, userEvent }) => {
    const input = canvas.getByPlaceholderText<HTMLTextAreaElement>("Ask a follow-up...")
    await waitFor(() => expect(input).toHaveFocus())
    await userEvent.type(input, "  hello world  ")
    await userEvent.keyboard("{Enter}")
    expect(args.onSend).toHaveBeenCalledTimes(1)
    expect(args.onSend).toHaveBeenCalledWith("hello world")
    expect(input.value).toBe("")
  },
}

export const ShiftEnterNewline: Story = {
  play: async ({ canvas, args, userEvent }) => {
    const input = canvas.getByPlaceholderText<HTMLTextAreaElement>("Ask a follow-up...")
    await userEvent.type(input, "first line")
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}")
    await userEvent.type(input, "second line")
    expect(args.onSend).not.toHaveBeenCalled()
    expect(input.value).toBe("first line\nsecond line")
  },
}

export const WhitespaceOnly: Story = {
  play: async ({ canvas, args, userEvent }) => {
    const input = canvas.getByPlaceholderText<HTMLTextAreaElement>("Ask a follow-up...")
    await userEvent.type(input, "   ")
    expect(canvas.getByRole("button")).toBeDisabled()
    await userEvent.keyboard("{Enter}")
    expect(args.onSend).not.toHaveBeenCalled()
  },
}

export const CancelMode: Story = {
  args: {
    mode: "cancel",
  },
  play: async ({ canvas, canvasElement, args, userEvent }) => {
    expect(canvasElement.querySelector('[class*="bg-neutral-50"]')).not.toBeNull()
    const input = canvas.getByPlaceholderText<HTMLTextAreaElement>("Ask a follow-up...")
    await userEvent.type(input, "still running")
    await userEvent.keyboard("{Enter}")
    expect(args.onSend).not.toHaveBeenCalled()
    expect(input.value).toBe("still running")
  },
}

export const AwaitingAnswer: Story = {
  args: {
    awaitingAnswer: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Or type your own answer...")).toBeVisible()
  },
}
