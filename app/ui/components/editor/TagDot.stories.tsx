import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { TagDot } from "./FileHeader"

const interviewTag: TagDefinition = {
  id: "tag-interview",
  label: "interview",
  color: "blue",
  icon: "activity",
}

const meta: Meta<typeof TagDot> = {
  title: "Custom/Editor/TagDot",
  component: TagDot,
}

export default meta
type Story = StoryObj<typeof TagDot>

export const Static: Story = {
  args: { tag: interviewTag },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole("button")).toBeNull()
  },
}

export const Removable: Story = {
  args: { tag: interviewTag, onRemove: fn() },
  play: async ({ canvasElement, args }) => {
    const dot = within(canvasElement).getByRole("button", { name: /remove/i })
    await userEvent.click(dot)
    expect(args.onRemove).toHaveBeenCalledOnce()
  },
}
