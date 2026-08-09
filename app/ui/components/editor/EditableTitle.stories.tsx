import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { EditableTitle } from "./FileHeader"

const meta: Meta<typeof EditableTitle> = {
  title: "Custom/Editor/EditableTitle",
  component: EditableTitle,
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof EditableTitle>

const openEditor = async (canvasElement: HTMLElement): Promise<HTMLInputElement> => {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole("button"))
  return await waitFor(() => canvas.getByRole("textbox") as HTMLInputElement)
}

export const ClickToEdit: Story = {
  args: { title: "Interview Notes", onRename: fn() },
  play: async ({ canvasElement }) => {
    const input = await openEditor(canvasElement)
    await waitFor(() => {
      expect(document.activeElement).toBe(input)
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe("Interview Notes".length)
    })
  },
}

export const EnterCommitsTrimmed: Story = {
  args: { title: "Interview Notes", onRename: fn() },
  play: async ({ canvasElement, args }) => {
    const input = await openEditor(canvasElement)
    await userEvent.clear(input)
    await userEvent.type(input, "  Revised Title  {Enter}")
    expect(args.onRename).toHaveBeenCalledOnce()
    expect(args.onRename).toHaveBeenCalledWith("Revised Title")
    await waitFor(() => {
      expect(within(canvasElement).getByRole("button")).toHaveTextContent("Interview Notes")
    })
  },
}

export const EscapeCancels: Story = {
  args: { title: "Interview Notes", onRename: fn() },
  play: async ({ canvasElement, args }) => {
    const input = await openEditor(canvasElement)
    await userEvent.clear(input)
    await userEvent.type(input, "Discarded Draft{Escape}")
    expect(args.onRename).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(within(canvasElement).getByRole("button")).toHaveTextContent("Interview Notes")
    })
  },
}

export const EmptyCommitDoesNotFire: Story = {
  args: { title: "Interview Notes", onRename: fn() },
  play: async ({ canvasElement, args }) => {
    const input = await openEditor(canvasElement)
    await userEvent.clear(input)
    await userEvent.type(input, "{Enter}")
    expect(args.onRename).not.toHaveBeenCalled()
  },
}

export const UnchangedCommitDoesNotFire: Story = {
  args: { title: "Interview Notes", onRename: fn() },
  play: async ({ canvasElement, args }) => {
    const input = await openEditor(canvasElement)
    await userEvent.type(input, "{Enter}")
    expect(args.onRename).not.toHaveBeenCalled()
  },
}

export const RenameRequested: Story = {
  args: {
    title: "Interview Notes",
    onRename: fn(),
    renameRequested: true,
    onRenameSettled: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole("textbox")
    expect(input).toBeInTheDocument()
    await userEvent.type(input, "{Escape}")
    expect(args.onRenameSettled).toHaveBeenCalledOnce()
  },
}
