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

export const dragHandlers = () => ({
  onDragEnter: fn(),
  onDragLeave: fn(),
  onDragOver: fn(),
  onDrop: fn(),
})
