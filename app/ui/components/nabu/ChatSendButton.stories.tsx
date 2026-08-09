import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, waitFor, within } from "storybook/test"
import { ChatSendButton, type ChatButtonMode } from "./ChatSendButton"

const modes: ChatButtonMode[] = ["send", "skip-ask", "cancel", "cancel-plan"]

const modeTooltip: Record<ChatButtonMode, string> = {
  send: "Send",
  "skip-ask": "Skip question",
  cancel: "Cancel",
  "cancel-plan": "Cancel plan",
}

const meta: Meta<typeof ChatSendButton> = {
  title: "Custom/Chat/ChatSendButton",
  component: ChatSendButton,
  args: {
    mode: "send",
    onSend: fn(),
    onSkipAsk: fn(),
    onCancel: fn(),
    onCancelPlan: fn(),
  },
}

export default meta
type Story = StoryObj<typeof ChatSendButton>

const singleModePlay =
  (
    mode: ChatButtonMode,
    firing: "onSend" | "onSkipAsk" | "onCancel" | "onCancelPlan"
  ): Story["play"] =>
  async ({ canvas, args, userEvent }) => {
    const button = canvas.getByRole("button")
    await userEvent.hover(button)
    await waitFor(() =>
      expect(within(document.body).getAllByText(modeTooltip[mode]).length).toBeGreaterThan(0)
    )
    await userEvent.click(button)
    for (const callback of ["onSend", "onSkipAsk", "onCancel", "onCancelPlan"] as const) {
      if (callback === firing) expect(args[callback]).toHaveBeenCalledTimes(1)
      else expect(args[callback]).not.toHaveBeenCalled()
    }
  }

export const Send: Story = {
  args: { mode: "send" },
  play: singleModePlay("send", "onSend"),
}

export const SkipAsk: Story = {
  args: { mode: "skip-ask" },
  play: singleModePlay("skip-ask", "onSkipAsk"),
}

export const Cancel: Story = {
  args: { mode: "cancel" },
  play: singleModePlay("cancel", "onCancel"),
}

export const CancelPlan: Story = {
  args: { mode: "cancel-plan" },
  play: singleModePlay("cancel-plan", "onCancelPlan"),
}

const matrixCallbacks = {
  onSend: fn(),
  onSkipAsk: fn(),
  onCancel: fn(),
  onCancelPlan: fn(),
}

export const ModeMatrix: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8 }}>
      {modes.map((mode) => (
        <div key={mode} data-testid={mode}>
          <ChatSendButton mode={mode} {...matrixCallbacks} />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvas }) => {
    const iconClasses = modes.map(
      (mode) => canvas.getByTestId(mode).querySelector("svg")?.getAttribute("class") ?? ""
    )
    expect(new Set(iconClasses).size).toBe(modes.length)
    for (const iconClass of iconClasses) expect(iconClass).not.toBe("")
  },
}

export const DisabledMatrix: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8 }}>
      {modes.map((mode) => (
        <div key={mode} data-testid={mode}>
          <ChatSendButton mode={mode} disabled {...matrixCallbacks} />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvas }) => {
    for (const mode of modes) {
      expect(within(canvas.getByTestId(mode)).getByRole("button")).toBeDisabled()
    }
  },
}
