import { afterToolResult, alreadyFired, systemNudge, type Nudger } from "../nudge-tools"
import type { FileStore } from "~/lib/files/store"
import { SETTINGS_FILE } from "~/lib/files/filename"
import { SETTINGS_READ_MARKER, formatFileContext } from "../../context-blocks"

export const createSettingsNudge =
  (getFiles: () => FileStore): Nudger =>
  (history) => {
    if (!afterToolResult(history)) return null
    if (alreadyFired(history, SETTINGS_READ_MARKER)) return null

    const settings = getFiles()[SETTINGS_FILE]
    if (!settings) return null

    return systemNudge(formatFileContext(SETTINGS_READ_MARKER, SETTINGS_FILE, settings))
  }
