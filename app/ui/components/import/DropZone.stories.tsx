import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent } from "storybook/test"
import { withSize } from "../../../../.storybook/decorators"
import { dragHandlers } from "./fixtures"
import { DropZone } from "./DropZone"

const zoneElement = (canvasElement: HTMLElement): HTMLElement =>
  canvasElement.querySelector(".border-dashed") as HTMLElement

const expectHighlighted = (zone: HTMLElement) => {
  expect(zone.className).toContain("border-brand-600")
  expect(zone.className).toContain("bg-brand-100")
}

const meta: Meta<typeof DropZone> = {
  title: "Custom/Import/DropZone",
  component: DropZone,
  args: { dragHandlers: dragHandlers() },
  decorators: [withSize({ width: "560px" })],
}

export default meta
type Story = StoryObj<typeof DropZone>

export const FullIdle: Story = {
  args: { variant: "full", isDragging: false },
}

export const FullDragging: Story = {
  args: { variant: "full", isDragging: true },
  play: async ({ canvasElement }) => {
    expectHighlighted(zoneElement(canvasElement))
  },
}

export const CompactIdle: Story = {
  args: { variant: "compact", isDragging: false },
}

export const CompactDragging: Story = {
  args: { variant: "compact", isDragging: true },
  play: async ({ canvasElement }) => {
    expectHighlighted(zoneElement(canvasElement))
  },
}

export const DragEventsReachHandlers: Story = {
  args: { variant: "full", isDragging: false, dragHandlers: dragHandlers() },
  play: async ({ args, canvasElement }) => {
    const zone = zoneElement(canvasElement)

    await fireEvent.dragEnter(zone)
    await fireEvent.dragOver(zone)
    await fireEvent.dragLeave(zone)
    await fireEvent.drop(zone)

    expect(args.dragHandlers.onDragEnter).toHaveBeenCalled()
    expect(args.dragHandlers.onDragOver).toHaveBeenCalled()
    expect(args.dragHandlers.onDragLeave).toHaveBeenCalled()
    expect(args.dragHandlers.onDrop).toHaveBeenCalled()
  },
}
