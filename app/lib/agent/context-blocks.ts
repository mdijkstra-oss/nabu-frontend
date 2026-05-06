import type { SystemBlock } from "./client/blocks"
import type { FileStore } from "~/lib/files/store"
import { SETTINGS_FILE, PREFERENCES_FILE } from "~/lib/files/filename"

export const SETTINGS_READ_MARKER = "## READ SETTINGS"
export const MEMORY_READ_MARKER = "## READ MEMORY"

export const formatFileContext = (marker: string, filename: string, content: string): string =>
  `\n${marker}\n<file ${filename}>\n${content}\n</file ${filename}>\n\nContinue.\n`

const toSystemBlock = (content: string): SystemBlock => ({ type: "system", content })

export const buildFileContextBlocks = (files: FileStore): SystemBlock[] => {
  const blocks: SystemBlock[] = []

  const settings = files[SETTINGS_FILE]
  if (settings) {
    blocks.push(toSystemBlock(formatFileContext(SETTINGS_READ_MARKER, SETTINGS_FILE, settings)))
  }

  const preferences = files[PREFERENCES_FILE]
  if (preferences) {
    blocks.push(toSystemBlock(formatFileContext(MEMORY_READ_MARKER, PREFERENCES_FILE, preferences)))
  }

  return blocks
}
