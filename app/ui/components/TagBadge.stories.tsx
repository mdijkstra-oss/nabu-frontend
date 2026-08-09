import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { TagBadge } from "./TagBadge"

const tag: TagDefinition = {
  id: "tag-method",
  label: "method",
  color: "grass",
  icon: "tag",
}

const meta: Meta<typeof TagBadge> = {
  title: "Custom/Primitives/TagBadge",
  component: TagBadge,
  args: { tag },
}

export default meta
type Story = StoryObj<typeof TagBadge>

export const Active: Story = {}

export const Inactive: Story = {
  args: { active: false },
}

export const Disabled: Story = {
  args: { disabled: true, onClick: fn() },
}

export const Removable: Story = {
  args: { onRemove: fn() },
}

export const Clickable: Story = {
  args: { onClick: fn() },
}

export const RemoveFiresOnlyOnRemove: Story = {
  args: { onClick: fn(), onRemove: fn() },
  play: async ({ args, canvas }) => {
    const [, removeButton] = canvas.getAllByRole("button")
    await userEvent.click(removeButton)
    expect(args.onRemove).toHaveBeenCalledOnce()
    expect(args.onClick).not.toHaveBeenCalled()
  },
}
