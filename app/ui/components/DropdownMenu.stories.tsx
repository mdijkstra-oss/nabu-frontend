import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import * as SubframeCore from "@subframe/core"
import { Copy, Pencil, Trash2 } from "lucide-react"
import { DropdownMenu } from "./DropdownMenu"

const onRename = fn()
const onDuplicate = fn()
const onDelete = fn()

const meta: Meta<typeof DropdownMenu> = {
  title: "Custom/Primitives/DropdownMenu",
  component: DropdownMenu,
}

export default meta
type Story = StoryObj<typeof DropdownMenu>

export const OpensFromTrigger: Story = {
  render: () => (
    <SubframeCore.DropdownMenu.Root>
      <SubframeCore.DropdownMenu.Trigger asChild={true}>
        <button type="button">Open menu</button>
      </SubframeCore.DropdownMenu.Trigger>
      <SubframeCore.DropdownMenu.Portal>
        <SubframeCore.DropdownMenu.Content
          side="bottom"
          align="start"
          sideOffset={4}
          asChild={true}
        >
          <DropdownMenu>
            <DropdownMenu.DropdownItem icon={<Pencil />} onClick={onRename}>
              Rename
            </DropdownMenu.DropdownItem>
            <DropdownMenu.DropdownItem icon={<Copy />} onClick={onDuplicate}>
              Duplicate
            </DropdownMenu.DropdownItem>
            <DropdownMenu.DropdownDivider />
            <DropdownMenu.DropdownItem icon={<Trash2 />} onClick={onDelete}>
              Delete
            </DropdownMenu.DropdownItem>
          </DropdownMenu>
        </SubframeCore.DropdownMenu.Content>
      </SubframeCore.DropdownMenu.Portal>
    </SubframeCore.DropdownMenu.Root>
  ),
  play: async ({ canvas }) => {
    onDuplicate.mockClear()

    await userEvent.click(canvas.getByRole("button", { name: "Open menu" }))

    const page = within(document.body)
    await waitFor(() => expect(page.getByText("Rename")).toBeVisible())
    expect(page.getByText("Duplicate")).toBeVisible()
    expect(page.getByText("Delete")).toBeVisible()

    await userEvent.click(page.getByText("Duplicate"))
    await waitFor(() => expect(onDuplicate).toHaveBeenCalledOnce())
  },
}
