import { afterToolResult, alreadyFired, systemNudge, type Nudger } from "../nudge-tools"
import type { FileStore } from "~/lib/files/store"
import { PREFERENCES_FILE } from "~/lib/files/filename"
import { MEMORY_READ_MARKER, formatFileContext } from "../../context-blocks"

export const createMemoryNudge =
  (getFiles: () => FileStore): Nudger =>
  (history) => {
    if (!afterToolResult(history)) return null
    if (alreadyFired(history, MEMORY_READ_MARKER)) return null

    const memory = getFiles()[PREFERENCES_FILE]
    if (!memory) return null

    return systemNudge(formatFileContext(MEMORY_READ_MARKER, PREFERENCES_FILE, memory))
  }
