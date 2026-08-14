import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn } from "storybook/test"
import type { ImportFile } from "~/lib/import/types"
import { deriveProgress } from "~/ui/hooks/fileImportRows"
import { withSize } from "../../../../.storybook/decorators"
import { importFile, mixedQueue } from "./fixtures"
import { FileImportList } from "./FileImportList"

const midFiles: ImportFile[] = [
  importFile("interview-1", "completed"),
  importFile("interview-2", "completed"),
  importFile("interview-3", "processing"),
  importFile("interview-4", "pending"),
  importFile("interview-5", "pending"),
]

const completeFiles: ImportFile[] = [
  importFile("interview-1", "completed"),
  importFile("interview-2", "completed"),
  importFile("interview-3", "completed"),
  importFile("scan", "unsupported"),
  importFile("broken", "error", { error: "Could not parse file" }),
]

const progressBar = (canvasElement: HTMLElement): HTMLElement =>
  canvasElement.querySelector(".bg-neutral-200 > div") as HTMLElement

const meta: Meta<typeof FileImportList> = {
  title: "Custom/Import/FileImportList",
  component: FileImportList,
  decorators: [withSize({ width: "560px" })],
}

export default meta
type Story = StoryObj<typeof FileImportList>

export const MidProcessing: Story = {
  args: {
    files: midFiles,
    progress: { total: 5, completed: 2, incomplete: 0, failed: 0, unsupported: 0, processed: 2 },
    isProcessing: true,
    onCancel: fn(),
  },
  play: async ({ canvas, canvasElement }) => {
    expect(canvas.getByText("Processing files...")).toBeInTheDocument()
    expect(canvas.getByText("2 of 5 files processed")).toBeInTheDocument()
    expect(progressBar(canvasElement).style.width).toBe("40%")
  },
}

export const MixedQueue: Story = {
  args: {
    files: mixedQueue,
    progress: deriveProgress(mixedQueue),
    isProcessing: true,
    onCancel: fn(),
  },
  play: async ({ canvas, canvasElement }) => {
    expect(canvas.getByText("Processing files...")).toBeInTheDocument()
    expect(canvas.getByText("3 of 5 files processed")).toBeInTheDocument()
    expect(canvas.getByText("1 added, 1 incomplete, 1 unsupported")).toBeInTheDocument()
    expect(progressBar(canvasElement).style.width).toBe("60%")

    expect(canvas.getByText("Queued").closest(".shadow-sm")?.className).toContain("opacity-50")
    expect(
      canvas.getByText("Classifying...").closest(".shadow-sm")?.querySelector(".animate-spin")
    ).not.toBeNull()
    expect(canvas.getByText("Imported, processing incomplete")).toBeInTheDocument()
    expect(canvas.getByText("24.0 KB - Classification failed")).toBeInTheDocument()
    expect(canvas.getByText("Added")).toBeInTheDocument()
  },
}

export const Complete: Story = {
  args: {
    files: completeFiles,
    progress: { total: 5, completed: 3, incomplete: 0, failed: 1, unsupported: 1, processed: 5 },
    isProcessing: false,
    onCancel: fn(),
  },
  play: async ({ canvas, canvasElement }) => {
    expect(canvas.getByText("Import complete")).toBeInTheDocument()
    expect(canvas.getByText("3 added, 1 failed, 1 unsupported")).toBeInTheDocument()
    expect(canvas.queryByText("Cancel all")).toBeNull()
    expect(progressBar(canvasElement).style.width).toBe("100%")
  },
}
