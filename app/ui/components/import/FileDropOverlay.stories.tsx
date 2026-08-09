import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import { dragHandlers, importFile } from "./fixtures"
import { FileDropOverlay } from "./FileDropOverlay"

const meta: Meta<typeof FileDropOverlay> = {
  title: "Custom/Import/FileDropOverlay",
  component: FileDropOverlay,
  args: {
    isVisible: true,
    isDragging: false,
    files: [],
    progress: { total: 0, completed: 0, failed: 0, unsupported: 0, processed: 0 },
    isProcessing: false,
    dragHandlers: dragHandlers(),
    onDismiss: fn(),
  },
}

export default meta
type Story = StoryObj<typeof FileDropOverlay>

export const Hidden: Story = {
  args: { isVisible: false },
  play: async ({ canvasElement }) => {
    expect(canvasElement).toBeEmptyDOMElement()
  },
}

export const EmptyDragging: Story = {
  args: { isDragging: true },
  play: async ({ canvas }) => {
    expect(canvas.getByText("Drop files to analyze and import")).toBeInTheDocument()
  },
}

export const Processing: Story = {
  args: {
    files: [importFile("interview-1", "completed"), importFile("interview-2", "processing")],
    progress: { total: 2, completed: 1, failed: 0, unsupported: 0, processed: 1 },
    isProcessing: true,
  },
  play: async ({ canvas }) => {
    expect(canvas.getByText("Drop more files to add them to the import queue")).toBeInTheDocument()
    expect(canvas.getByText("Processing files...")).toBeInTheDocument()
    expect(canvas.queryByText("Close")).toBeNull()
  },
}

export const StalledIncomplete: Story = {
  args: {
    files: [importFile("interview-1", "completed"), importFile("interview-2", "error")],
    progress: { total: 3, completed: 1, failed: 1, unsupported: 0, processed: 2 },
    isProcessing: false,
  },
  play: async ({ canvas }) => {
    expect(canvas.queryByText("Close")).toBeNull()
  },
}

export const Complete: Story = {
  args: {
    files: [importFile("interview-1", "completed"), importFile("interview-2", "completed")],
    progress: { total: 2, completed: 2, failed: 0, unsupported: 0, processed: 2 },
    isProcessing: false,
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Close"))
    expect(args.onDismiss).toHaveBeenCalledOnce()
  },
}
