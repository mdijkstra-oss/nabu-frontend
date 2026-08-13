import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { TagPill } from "./TagPill"

const tags: TagDefinition[] = [
  { id: "tag-interview", label: "interview", color: "blue", icon: "activity" },
  { id: "tag-fieldwork", label: "fieldwork", color: "green", icon: "anchor" },
  { id: "tag-memo", label: "memo", color: "amber", icon: "tag" },
]

const meta: Meta<typeof TagPill> = {
  title: "Custom/Editor/TagPill",
  component: TagPill,
}

export default meta
type Story = StoryObj<typeof TagPill>

export const SingleDot: Story = {
  args: { tags: tags.slice(0, 1) },
}

export const MultipleDots: Story = {
  args: { tags },
}

export const StaticWithoutToggle: Story = {
  args: { tags: tags.slice(0, 2) },
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByLabelText("Tags"))
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(within(document.body).queryByText("Interview")).toBeNull()
  },
}

export const EmptyShowsPlaceholderDot: Story = {
  args: { tags: [], availableTags: tags, onToggleTag: fn() },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByLabelText("Tags")).toBeInTheDocument()
  },
}

export const HoverListsTags: Story = {
  args: { tags: tags.slice(0, 1), availableTags: tags, onToggleTag: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.hover(within(canvasElement).getByLabelText("Tags"))
    const body = within(document.body)
    await waitFor(() => expect(body.getByText("Fieldwork")).toBeInTheDocument())

    await userEvent.click(body.getByText("Fieldwork"))
    expect(args.onToggleTag).toHaveBeenCalledWith("tag-fieldwork", true)

    await userEvent.click(body.getByText("Interview"))
    expect(args.onToggleTag).toHaveBeenCalledWith("tag-interview", false)
  },
}
