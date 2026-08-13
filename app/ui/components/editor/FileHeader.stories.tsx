import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { Download, Trash2 } from "lucide-react"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"
import { formatShortDate } from "~/lib/format/date"
import { withSize } from "../../../../.storybook/decorators"
import { FileHeader } from "./FileHeader"

const tags: TagDefinition[] = [
  { id: "tag-interview", label: "interview", color: "blue", icon: "activity" },
  { id: "tag-fieldwork", label: "fieldwork", color: "green", icon: "anchor" },
]

const meta: Meta<typeof FileHeader> = {
  title: "Custom/Editor/FileHeader",
  component: FileHeader,
  decorators: [withSize({ width: "480px" })],
}

export default meta
type Story = StoryObj<typeof FileHeader>

export const StaticTitle: Story = {
  args: { title: "Interview Notes" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText("Interview Notes").tagName).toBe("SPAN")
    expect(canvas.queryByRole("button")).toBeNull()
  },
}

export const LinkTitle: Story = {
  args: { title: "Interview Notes", onTitleClick: fn() },
  play: async ({ canvasElement, args }) => {
    const title = within(canvasElement).getByRole("button", { name: "Interview Notes" })
    await userEvent.click(title)
    expect(args.onTitleClick).toHaveBeenCalledOnce()
  },
}

export const RenamableTitle: Story = {
  args: { title: "Interview Notes", onRename: fn(), onTitleClick: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Interview Notes" }))
    expect(await waitFor(() => canvas.getByRole("textbox"))).toHaveValue("Interview Notes")
    expect(args.onTitleClick).not.toHaveBeenCalled()
  },
}

export const TagsReadOnly: Story = {
  args: { title: "Interview Notes", tags },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByLabelText("Tags")).toBeInTheDocument()
  },
}

export const TagsTogglable: Story = {
  args: { title: "Interview Notes", tags, availableTags: tags, onToggleTag: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.hover(within(canvasElement).getByLabelText("Tags"))
    const row = await waitFor(() => within(document.body).getByText("Fieldwork"))
    await userEvent.click(row)
    expect(args.onToggleTag).toHaveBeenCalledWith("tag-fieldwork", false)
  },
}

export const WithDate: Story = {
  args: { title: "Interview Notes", date: "2026-03-15" },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText(formatShortDate("2026-03-15"))).toBeInTheDocument()
  },
}

export const WithMenu: Story = {
  args: {
    title: "Interview Notes",
    menuGroups: [
      [
        { icon: <Download />, label: "Export", onClick: fn() },
        { icon: <Trash2 />, label: "Delete", onClick: fn() },
      ],
    ],
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button"))
    const exportItem = await waitFor(() => within(document.body).getByText("Export"))
    await userEvent.click(exportItem)
    await waitFor(() => expect(args.menuGroups?.[0][0].onClick).toHaveBeenCalledOnce())
  },
}

export const MenuDisabledItem: Story = {
  args: {
    title: "Interview Notes",
    menuGroups: [
      [
        { icon: <Download />, label: "Export", onClick: fn(), disabled: true },
        { icon: <Trash2 />, label: "Delete", onClick: fn() },
      ],
    ],
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button"))
    const exportItem = await waitFor(() => within(document.body).getByText("Export"))
    await userEvent.click(exportItem)
    expect(args.menuGroups?.[0][0].onClick).not.toHaveBeenCalled()
  },
}

export const MenuGroupsDivided: Story = {
  args: {
    title: "Interview Notes",
    menuGroups: [
      [{ icon: <Trash2 />, label: "Delete", onClick: fn() }],
      [{ icon: <Download />, label: "Copy raw", onClick: fn() }],
    ],
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button"))
    await waitFor(() => expect(within(document.body).getByText("Copy raw")).toBeInTheDocument())
  },
}

export const MenuConfirmDelete: Story = {
  args: {
    title: "Interview Notes",
    menuGroups: [[{ icon: <Trash2 />, label: "Delete", onClick: fn(), confirm: true }]],
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button"))
    const deleteItem = await waitFor(() => within(document.body).getByText("Delete"))

    await userEvent.click(deleteItem)
    expect(args.menuGroups?.[0][0].onClick).not.toHaveBeenCalled()
    const confirmItem = await waitFor(() => within(document.body).getByText("Confirm"))

    await userEvent.click(confirmItem)
    await waitFor(() => expect(args.menuGroups?.[0][0].onClick).toHaveBeenCalledOnce())
  },
}

export const WithTrailing: Story = {
  args: {
    title: "Interview Notes",
    trailing: <span data-testid="trailing-slot">saved</span>,
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByTestId("trailing-slot")).toHaveTextContent("saved")
  },
}
