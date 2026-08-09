import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, waitFor } from "storybook/test"
import { withSize } from "../../../../.storybook/decorators"
import { EditGroupCard } from "./EditGroupCard"
import { editGroupSingle, editGroupMulti } from "./fixtures"

const meta: Meta<typeof EditGroupCard> = {
  title: "Custom/Chat/EditGroupCard",
  component: EditGroupCard,
  decorators: [withSize({ width: "380px" })],
  args: {
    onSelectFile: fn(),
  },
}

export default meta
type Story = StoryObj<typeof EditGroupCard>

export const SingleEntry: Story = {
  args: {
    message: editGroupSingle,
  },
  play: async ({ canvas, canvasElement, args, userEvent }) => {
    expect(canvasElement.querySelector("svg.lucide-chevron-right")).toBeNull()
    await userEvent.click(canvas.getByText(/Onboarding felt rushed/))
    expect(args.onSelectFile).toHaveBeenCalledTimes(1)
    expect(args.onSelectFile).toHaveBeenCalledWith("interviews.md")
  },
}

export const MultipleEntries: Story = {
  args: {
    message: editGroupMulti,
  },
  play: async ({ canvas, canvasElement, args, userEvent }) => {
    expect(canvasElement.querySelector("svg.lucide-chevron-right")).not.toBeNull()
    await userEvent.click(canvas.getByText("3 changes across 3 files"))
    expect(args.onSelectFile).not.toHaveBeenCalled()

    await waitFor(() => expect(canvas.getByText(/Exit reasons cluster on pay/)).toBeVisible())
    await userEvent.click(canvas.getByText(/Exit reasons cluster on pay/))
    expect(args.onSelectFile).toHaveBeenLastCalledWith("exit_notes.md")

    await userEvent.click(canvas.getByText(/Stale tag/))
    expect(args.onSelectFile).toHaveBeenLastCalledWith("settings.md")
    expect(args.onSelectFile).toHaveBeenCalledTimes(2)
  },
}
