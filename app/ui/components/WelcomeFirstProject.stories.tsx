import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import { withSize } from "../../../.storybook/decorators"
import { WelcomeFirstProject } from "./WelcomeFirstProject"

const meta: Meta<typeof WelcomeFirstProject> = {
  title: "Custom/Primitives/WelcomeFirstProject",
  component: WelcomeFirstProject,
  args: { onCreate: fn() },
  decorators: [withSize({ height: "480px" })],
}

export default meta
type Story = StoryObj<typeof WelcomeFirstProject>

export const Default: Story = {}

export const CreateFiresCallback: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Create my first project" }))
    expect(args.onCreate).toHaveBeenCalledOnce()
  },
}

export const Creating: Story = {
  args: { creating: true },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button"))
    expect(args.onCreate).not.toHaveBeenCalled()
  },
}

export const Failed: Story = {
  args: { error: "POST /commands failed: 503 Service Unavailable" },
  play: async ({ canvas }) => {
    expect(canvas.getByText(/503 Service Unavailable/)).toBeInTheDocument()
  },
}
