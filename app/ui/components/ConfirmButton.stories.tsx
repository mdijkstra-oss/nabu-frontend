import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"
import { Trash2 } from "lucide-react"
import { ConfirmButton } from "./ConfirmButton"

const meta: Meta<typeof ConfirmButton> = {
  title: "Custom/Primitives/ConfirmButton",
  component: ConfirmButton,
  args: { icon: <Trash2 />, label: "Delete", onConfirm: fn() },
}

export default meta
type Story = StoryObj<typeof ConfirmButton>

export const Idle: Story = {}

export const Disabled: Story = {
  args: { disabled: true },
}

export const TwoStepConfirm: Story = {
  play: async ({ args, canvas }) => {
    const button = canvas.getByRole("button")

    await userEvent.click(button)
    await waitFor(() => expect(canvas.getByText("Confirm")).toBeInTheDocument())
    expect(button.className).toContain("bg-error-600")
    expect(args.onConfirm).not.toHaveBeenCalled()

    await userEvent.click(button)
    expect(args.onConfirm).toHaveBeenCalledOnce()
    await waitFor(() => expect(button).toBeDisabled())
    expect(button.className).toContain("bg-success-600")
  },
}

export const MouseLeaveResetsArmed: Story = {
  play: async ({ args, canvas }) => {
    const button = canvas.getByRole("button")

    await userEvent.click(button)
    await waitFor(() => expect(canvas.getByText("Confirm")).toBeInTheDocument())

    await userEvent.unhover(button)
    await waitFor(() => expect(canvas.getByText("Delete")).toBeInTheDocument())

    await userEvent.click(button)
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

const DisableFlipHarness = ({ onConfirm }: { onConfirm: () => void }) => {
  const [disabled, setDisabled] = useState(false)
  return (
    <div className="flex items-center gap-4">
      <ConfirmButton icon={<Trash2 />} label="Delete" onConfirm={onConfirm} disabled={disabled} />
      <button type="button" onClick={() => setDisabled((current) => !current)}>
        flip-disabled
      </button>
    </div>
  )
}

export const DisableFlipResetsArmed: Story = {
  render: (args) => <DisableFlipHarness onConfirm={args.onConfirm} />,
  play: async ({ args, canvas }) => {
    const flip = canvas.getByText("flip-disabled")

    await userEvent.click(canvas.getByText("Delete"))
    await waitFor(() => expect(canvas.getByText("Confirm")).toBeInTheDocument())

    await userEvent.click(flip)
    await waitFor(() => expect(canvas.getByText("Delete")).toBeInTheDocument())

    await userEvent.click(flip)
    await userEvent.click(canvas.getByText("Delete"))
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}
