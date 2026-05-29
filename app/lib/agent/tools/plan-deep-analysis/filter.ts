import type { FileEntry } from "../file-entry"
import type { Composite, Segment, PackedSegment } from "~/lib/composite/pack"
import type { NumberedParagraph } from "../scout-filter/messages"
import { getFileView } from "../file-view"
import { filterTarget } from "../scout-filter/api"
import { packComposites, sortSegments, resolveSegmentByChar } from "~/lib/composite/pack"
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

interface StrippedFile {
  path: string
  stripped: string
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

const stripSearchFiles = (files: FileEntry[]): StrippedFile[] =>
  files.flatMap((file) => {
    const content = getFileView(file.path)
    if (content === undefined) return []
    const { content: stripped, lineMap } = stripCodeBlockLines(content)
    if (stripped.trim().length === 0) return []
    return [{ path: file.path, stripped, lineMap }]
  })

const filesToSegments = (files: StrippedFile[]): Segment[] =>
  files.map((f) => ({
    path: f.path,
    startLine: 1,
    endLine: f.stripped.split("\n").length,
    content: f.stripped,
  }))

interface LocatedParagraph extends NumberedParagraph {
  path: string
}

const compositeLineAt = (content: string, charOffset: number): number => {
  let line = 1
  for (let i = 0; i < charOffset && i < content.length; i++) {
    if (content[i] === "\n") line++
  }
  return line
}

const resolveSource = (
  paragraph: NumberedParagraph,
  bin: Composite
): { packed: PackedSegment; lineOffset: number } | undefined => {
  const charOffset = bin.content.indexOf(paragraph.text)
  if (charOffset === -1) return undefined

  const packed = resolveSegmentByChar(bin, charOffset)
  if (!packed) return undefined

  const segStartInComposite = compositeLineAt(bin.content, packed.charStart)
  const lineOffset = paragraph.startLine - segStartInComposite

  return { packed, lineOffset }
}

const locateSurvivor = (
  paragraph: NumberedParagraph,
  bin: Composite
): LocatedParagraph | undefined => {
  const source = resolveSource(paragraph, bin)
  if (!source) return undefined

  return {
    index: paragraph.index,
    text: paragraph.text,
    startLine: source.packed.startLine + source.lineOffset,
    endLine:
      source.packed.startLine + source.lineOffset + (paragraph.endLine - paragraph.startLine),
    path: source.packed.path,
  }
}

const groupByPath = <T extends { path: string }>(items: T[]): Map<string, T[]> => {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const group = map.get(item.path) ?? []
    group.push(item)
    map.set(item.path, group)
  }
  return map
}

export const filterSearchTargets = async (
  files: FileEntry[],
  framework: string
): Promise<LabelItem[]> => {
  const stripped = stripSearchFiles(files)
  if (stripped.length === 0) return []

  const filesByPath = new Map(stripped.map((f) => [f.path, f]))

  const segments = filesToSegments(stripped)
  const bins = packComposites(sortSegments(segments), CHUNK_TARGET_CHARS, paragraphSeparator)

  const survivors: LocatedParagraph[] = []
  for (const bin of bins) {
    const { surviving } = await filterTarget(framework, bin.content)
    for (const s of surviving) {
      const located = locateSurvivor(s, bin)
      if (located) survivors.push(located)
    }
  }

  if (survivors.length === 0) return []

  const allItems: LabelItem[] = []
  for (const [path, paragraphs] of groupByPath(survivors)) {
    const file = filesByPath.get(path)
    if (!file) continue

    const chunks = chunkLines(file.stripped, CHUNK_TARGET_CHARS)
    const segments = mergeAndChunk(paragraphs, path, CHUNK_TARGET_CHARS, chunks)
    const sorted = sortSegments(segments)
    const composites = packComposites(sorted, CHUNK_TARGET_CHARS, paragraphSeparator)
    allItems.push(...composites.map((composite) => ({ path, composite, lineMap: file.lineMap })))
  }

  return allItems
}
