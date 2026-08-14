import { fn } from "storybook/test"
import type { ImportFile, ImportStatus } from "~/lib/import/types"

export const importFile = (
  id: string,
  status: ImportStatus,
  extra?: Partial<ImportFile>
): ImportFile => ({
  id,
  name: `${id}.md`,
  size: 24576,
  status,
  ...extra,
})

export const mixedQueue: ImportFile[] = [
  importFile("interview-1", "completed"),
  importFile("interview-2", "incomplete", { error: "Classification failed" }),
  importFile("interview-3", "classifying"),
  importFile("interview-4", "pending"),
  importFile("scan", "unsupported"),
]

export const dragHandlers = () => ({
  onDragEnter: fn(),
  onDragLeave: fn(),
  onDragOver: fn(),
  onDrop: fn(),
})
