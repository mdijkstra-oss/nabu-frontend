import type { FileEntry } from "../file-entry"
import type { Composite } from "~/lib/composite/pack"
import { getFileView } from "../file-view"
import { filterTarget } from "../scout-filter/api"
import { packComposites, sortSegments } from "~/lib/composite/pack"
import { mergeAndChunk, paragraphSeparator } from "~/lib/composite/merge"
import { chunkLines, CHUNK_TARGET_CHARS } from "~/lib/data-blocks/chunk-lines"
import { stripCodeBlockLines } from "~/lib/data-blocks/strip-lines"
import { processPool } from "~/lib/utils/pool"
import { errorMessage } from "~/lib/utils/error"

export interface LabelItem {
  path: string
  composite: Composite
  lineMap: number[]
}

const filterFileTarget = async (
  path: string,
  content: string,
  framework: string
): Promise<LabelItem[]> => {
  const { content: stripped, lineMap } = stripCodeBlockLines(content)
  const { surviving } = await filterTarget(framework, stripped)

  if (surviving.length === 0) return []

  const chunks = chunkLines(stripped, CHUNK_TARGET_CHARS)
  const segments = mergeAndChunk(surviving, path, CHUNK_TARGET_CHARS, chunks)
  const sorted = sortSegments(segments)
  const composites = packComposites(sorted, CHUNK_TARGET_CHARS, paragraphSeparator)

  return composites.map((composite) => ({ path, composite, lineMap }))
}

export const filterFileTargets = async (
  targetFiles: FileEntry[],
  framework: string
): Promise<LabelItem[]> => {
  const allItems: LabelItem[] = []

  const { failures } = await processPool(
    targetFiles,
    async (file: FileEntry) => {
      const content = getFileView(file.path)
      if (content === undefined) throw new Error(`Cannot read: ${file.path}`)
      const items = await filterFileTarget(file.path, content, framework)
      allItems.push(...items)
      return []
    },
    () => undefined,
    { concurrency: 3 }
  )

  if (failures.length > 0) {
    const details = failures.map((f) => `${(f.item as FileEntry).path}: ${errorMessage(f.error)}`)
    throw new Error(`Scout-filter failed:\n${details.join("\n")}`)
  }

  return allItems
}
