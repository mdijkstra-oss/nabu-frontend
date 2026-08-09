import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"
import type { ImportFile, ImportStatus } from "~/lib/import/types"
import { withSize } from "../../../../.storybook/decorators"
import { importFile } from "./fixtures"
import { FileImportItem, statusConfigs } from "./FileImportItem"

const fileWith = (status: ImportStatus, extra?: Partial<ImportFile>): ImportFile =>
  importFile(status, status, { name: `${status}-document.md`, ...extra })

const statusFiles: Record<ImportStatus, ImportFile> = {
  pending: fileWith("pending"),
  reading: fileWith("reading"),
  processing: fileWith("processing"),
  completed: fileWith("completed"),
  unsupported: fileWith("unsupported"),
  error: fileWith("error", { error: "Could not parse file" }),
}

const activeStatuses: ImportStatus[] = ["reading", "processing"]

const assertMatchesStatusConfig = (canvasElement: HTMLElement, status: ImportStatus) => {
  const config = statusConfigs[status]
  const row = canvasElement.querySelector(".shadow-sm") as HTMLElement

  const label = [...canvasElement.querySelectorAll("span")].find(
    (span) => span.textContent === config.label
  )
  if (!label) throw new globalThis.Error(`no span renders the label "${config.label}"`)
  expect(label.className).toContain(config.labelClass)

  expect(canvasElement.querySelector(`.bg-${config.iconVariant}-100`)).not.toBeNull()

  const spins = canvasElement.querySelector(".animate-spin") !== null
  expect(spins).toBe(activeStatuses.includes(status))

  expect(row.className.includes("opacity-50")).toBe(status === "pending")
}

const storyFor = (status: ImportStatus): Story => ({
  args: { file: statusFiles[status] },
  play: async ({ canvasElement }) => {
    assertMatchesStatusConfig(canvasElement, status)
  },
})

const meta: Meta<typeof FileImportItem> = {
  title: "Custom/Import/FileImportItem",
  component: FileImportItem,
  decorators: [withSize({ width: "480px" })],
}

export default meta
type Story = StoryObj<typeof FileImportItem>

export const Pending: Story = storyFor("pending")
export const Reading: Story = storyFor("reading")
export const Processing: Story = storyFor("processing")
export const Completed: Story = storyFor("completed")
export const Unsupported: Story = storyFor("unsupported")
export const Error: Story = {
  ...storyFor("error"),
  play: async (context) => {
    assertMatchesStatusConfig(context.canvasElement, "error")
    expect(context.canvas.getByText("24.0 KB - Could not parse file")).toBeInTheDocument()
  },
}

export const WithFinalPath: Story = {
  args: { file: fileWith("completed", { finalPath: "documents/interviews/interview-4.md" }) },
  play: async ({ canvas }) => {
    expect(canvas.getByText("documents/interviews/interview-4.md")).toBeInTheDocument()
    expect(canvas.queryByText("completed-document.md")).toBeNull()
  },
}
