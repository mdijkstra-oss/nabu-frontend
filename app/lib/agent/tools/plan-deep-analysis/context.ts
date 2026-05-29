import type { Block } from "../../client/blocks"
import type { FileEntry } from "../file-entry"
import type { SourceFileEntry } from "./def"
import type { LabeledTarget } from "./format"
import { formatTargetFile } from "./format"
import { getFileView } from "../file-view"
import { getFile, getFiles } from "~/lib/files/store"
import { pushBlocks, getAllBlocks } from "../../client/store"
import { PREFERENCES_FILE } from "~/lib/files/filename"
import { validateFrameworkNoCallouts } from "../apply-deep-analysis/messages"

const toSystemBlock = (content: string): Block => ({ type: "system", content })

const READ_MARKER = "## READ MEMORY"
const RECENCY_THRESHOLD = 15

export const findMissingFiles = (files: FileEntry[]): string[] =>
  files.filter((f) => getFile(f.path) === undefined).map((f) => f.path)

export const buildFramework = (sourceFiles: SourceFileEntry[]): string =>
  sourceFiles
    .filter((f) => f.group === "framework")
    .map((f) => getFileView(f.path) ?? "")
    .filter((c) => c.length > 0)
    .join("\n\n")

export const validateAnnotationSources = (sourceFiles: SourceFileEntry[]): string | null => {
  const frameworkPaths = sourceFiles.filter((f) => f.group === "framework").map((f) => f.path)
  return validateFrameworkNoCallouts(frameworkPaths, getFileView)
}

export const pushSourceBlocks = (sourceFiles: SourceFileEntry[]): void => {
  for (const file of sourceFiles) {
    const content = getFileView(file.path)
    if (content === undefined) continue
    pushBlocks([toSystemBlock(`File: ${file.path}\n${content}`)])
  }
}

const groupByPath = (labeled: LabeledTarget[]): Map<string, LabeledTarget[]> => {
  const map = new Map<string, LabeledTarget[]>()
  for (const t of labeled) {
    const group = map.get(t.path)
    if (group) group.push(t)
    else map.set(t.path, [t])
  }
  return map
}

export const pushTargetBlocks = (labeled: LabeledTarget[]): void => {
  for (const [path, targets] of groupByPath(labeled)) {
    pushBlocks([toSystemBlock(formatTargetFile(path, targets))])
  }
}

const isMemoryRecent = (blocks: Block[]): boolean => {
  let actionCount = 0
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block.type === "system" && block.content.includes(READ_MARKER)) return true
    if (block.type === "text" || block.type === "tool_call") actionCount++
    if (actionCount >= RECENCY_THRESHOLD) return false
  }
  return false
}

export const injectMemory = (): void => {
  const preferences = getFiles()[PREFERENCES_FILE] ?? null
  const blocks = getAllBlocks()
  if (!isMemoryRecent(blocks) && preferences) {
    pushBlocks([
      toSystemBlock(
        `${READ_MARKER}\n<file ${PREFERENCES_FILE}>\n${preferences}\n</file ${PREFERENCES_FILE}>`
      ),
    ])
  }
}
