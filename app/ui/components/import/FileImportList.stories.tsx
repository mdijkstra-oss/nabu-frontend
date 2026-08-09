import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn } from "storybook/test"
import type { ImportFile } from "~/lib/import/types"
import { FileImportList } from "./FileImportList"

const file = (
  id: string,
  status: ImportFile["status"],
  extra?: Partial<ImportFile>
): ImportFile => ({
  id,
  name: `${id}.md`,
  size: 24576,
  status,
  ...extra,
})

const midFiles: ImportFile[] = [
  file("interview-1", "completed"),
  file("interview-2", "completed"),
  file("interview-3", "processing"),
  file("interview-4", "pending"),
  file("interview-5", "pending"),
]

const completeFiles: ImportFile[] = [
  file("interview-1", "completed"),
  file("interview-2", "completed"),
  file("interview-3", "completed"),
  file("scan", "unsupported"),
  file("broken", "error", { error: "Could not parse file" }),
]

const progressBar = (canvasElement: HTMLElement): HTMLElement =>
  canvasElement.querySelector(".bg-neutral-200 > div") as HTMLElement

const meta: Meta<typeof FileImportList> = {
  title: "Custom/Import/FileImportList",
  component: FileImportList,
  decorators: [
    (Story) => (
      <div style={{ width: 560 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof FileImportList>

export const MidProcessing: Story = {
  args: {
    files: midFiles,
    progress: { total: 5, completed: 2, failed: 0, unsupported: 0, processed: 2 },
    isProcessing: true,
    onCancel: fn(),
  },
  play: async ({ canvas, canvasElement }) => {
    expect(canvas.getByText("Processing files...")).toBeInTheDocument()
    expect(canvas.getByText("2 of 5 files processed")).toBeInTheDocument()
    expect(progressBar(canvasElement).style.width).toBe("40%")
  },
}

export const Complete: Story = {
  args: {
    files: completeFiles,
    progress: { total: 5, completed: 3, failed: 1, unsupported: 1, processed: 5 },
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
