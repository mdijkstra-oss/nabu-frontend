import { getCodebook as computeCodebook } from "~/domain/data-blocks/callout/codes/selectors"
import {
  stripPendingRefs,
  markPendingRefs,
  resolvePendingRef,
  getAllDefinitions,
  rebuildDefinitionIndex,
  updateDefinitionIndex,
  removeFromDefinitionIndex,
  renameInDefinitionIndex,
  findPendingRefs,
  findDefinitionIds,
  findOrphanPendingRefs,
} from "./pending-refs"
import { resolveHiddenFile } from "./hidden-blocks"
import { countLines } from "~/lib/text/stats"
import { debounce, createScopedDebounce } from "~/lib/utils/debounce"
import { sendCommand } from "~/lib/server/sync/commands"
import type { Command } from "~/lib/server/sync/types"
import { normalizeContent as normalize } from "~/lib/patch/diff/normalize"
import {
  normalizeSingletonOrder,
  normalizeBlockFields,
  expandBlockIdRefs,
  type IdResolver,
} from "~/lib/data-blocks/normalize"
import { findAnnotationById } from "~/domain/data-blocks/attributes/annotations/selectors"
import { SETTINGS_FILE, PREFERENCES_FILE, isMarkdownFile, isCompanionFile } from "./filename"
import { validateStructural } from "~/lib/data-blocks/validate"
import { FileCorruptionError } from "./errors"

export const REQUIRED_FILES = [SETTINGS_FILE, PREFERENCES_FILE] as const

const normalizeFile = (text: string, resolveId?: IdResolver): string =>
  normalizeSingletonOrder(expandBlockIdRefs(normalizeBlockFields(normalize(text)), resolveId)) +
  "\n"
import { memoByRef } from "~/lib/utils/memo"

export type FileStore = Record<string, string>

type Listener = () => void

let files: FileStore = {}
let currentFile: string | null = null
const listeners = new Set<Listener>()

const memoizedCodebook = memoByRef(computeCodebook)

const notify = (): void => listeners.forEach((l) => l())
const debouncedNotify = debounce(notify, 80, { maxWait: 400 })

let projectId: string | null = null
let persistEnabled = true
let persistSuppressed = false
let pendingRefsSuppressed = false
const persistDebounce = createScopedDebounce(500)

export const getProjectId = (): string | null => projectId

export const setProjectId = (id: string | null): void => {
  projectId = id
}
export const setPersistEnabled = (enabled: boolean): void => {
  persistEnabled = enabled
}

export const setPendingRefsSuppressed = (suppressed: boolean): void => {
  pendingRefsSuppressed = suppressed
}

export const schedulePersist = (path: string): void => {
  persistWrite(path)
}

export const withoutPersist = <T>(fn: () => T): T => {
  persistSuppressed = true
  try {
    return fn()
  } finally {
    persistSuppressed = false
  }
}

// A rejected command leaves the file in this tab and nowhere else, and a reload is
// the moment that becomes visible. Reporting the server's reason is what makes the
// difference between a lost file and a fixable one.
const reportPersistFailure = (action: string, path: string, reason: string): void => {
  console.error(`[sync] ${action} ${path} was not saved: ${reason}`)
}

const persist = async (pid: string, path: string, command: Command): Promise<void> => {
  const result = await sendCommand(pid, command).catch((e: unknown) => ({
    ok: false as const,
    error: e instanceof Error ? e.message : String(e),
  }))
  if (!result.ok) reportPersistFailure(command.action, path, result.error)
}

const persistWrite = (path: string): void => {
  if (!projectId || !persistEnabled || persistSuppressed) return
  const pid = projectId
  persistDebounce.call(path, async () => {
    const content = files[path]
    if (content === undefined) return
    await persist(pid, path, { action: "WriteFile", path, content: stripPendingRefs(content) })
  })
}

const persistDeleteCommand = (path: string): void => {
  if (!projectId || !persistEnabled || persistSuppressed) return
  persistDebounce.cancel(path)
  void persist(projectId, path, { action: "DeleteFile", path })
}

const persistRenameCommand = (oldPath: string, newPath: string): void => {
  if (!projectId || !persistEnabled || persistSuppressed) return
  persistDebounce.cancel(oldPath)
  void persist(projectId, oldPath, { action: "RenameFile", path: oldPath, newPath })
}

export const getFiles = (): FileStore => files

export const getFilesStripped = (): FileStore =>
  Object.fromEntries(Object.entries(files).map(([k, v]) => [k, stripPendingRefs(v)]))

export const getCodebook = () => memoizedCodebook(files)

export const getFile = (filename: string): string | undefined =>
  files[filename] ?? resolveHiddenFile(filename)

export const getFileRaw = (filename: string): string => files[filename] ?? ""

export const getCurrentFile = (): string | null => currentFile

export const getFileLineCount = (filename: string): number => countLines(getFileRaw(filename))

export const setFiles = (newFiles: FileStore): void => {
  const resolveId: IdResolver = (id) => findAnnotationById(newFiles, id)?.text
  files = Object.fromEntries(
    Object.entries(newFiles).map(([k, v]) => [k, normalizeFile(stripPendingRefs(v), resolveId)])
  )
  rebuildDefinitionIndex(files)
  notify()
}

export const setCurrentFile = (filename: string | null): void => {
  currentFile = filename
  notify()
}

export interface UpdateFileOptions {
  immediate?: boolean
  skipPendingRefs?: boolean
}

export const updateFileRaw = (filename: string, raw: string, options?: UpdateFileOptions): void => {
  const resolveId: IdResolver | undefined = options?.skipPendingRefs
    ? undefined
    : (id) => findAnnotationById(files, id)?.text
  const normalized = normalizeFile(raw, resolveId)
  if (normalized === files[filename]) return

  if (isMarkdownFile(filename) && !isCompanionFile(filename)) {
    const errors = validateStructural(normalized)
    if (errors.length > 0) {
      const corruption = new FileCorruptionError(filename, errors)
      console.error("[file-store]", corruption.message, { path: filename, errors, raw })
      throw corruption
    }
  }

  const scheduleNotify = options?.immediate ? notify : debouncedNotify

  if (options?.skipPendingRefs || pendingRefsSuppressed) {
    if (!options?.skipPendingRefs) updateDefinitionIndex(filename, normalized)
    files = { ...files, [filename]: normalized }
    persistWrite(filename)
    scheduleNotify()
    return
  }

  updateDefinitionIndex(filename, normalized)

  const definitions = getAllDefinitions()
  const marked = markPendingRefs(normalized, definitions)

  const newDefinitions = findDefinitionIds(normalized)
  let updatedFiles: FileStore = { ...files, [filename]: marked }
  const resolvedPaths: string[] = []

  for (const defId of newDefinitions) {
    for (const [path, content] of Object.entries(updatedFiles)) {
      if (path === filename) continue
      const pendingRefIds = findPendingRefs(content)
      if (pendingRefIds.includes(defId)) {
        const resolved = resolvePendingRef(content, defId)
        updatedFiles = { ...updatedFiles, [path]: resolved }
        resolvedPaths.push(path)
      }
    }
  }

  files = updatedFiles
  persistWrite(filename)
  for (const path of resolvedPaths) persistWrite(path)
  scheduleNotify()
}

export const deleteFile = (filename: string): void => {
  removeFromDefinitionIndex(filename)
  const { [filename]: _, ...rest } = files
  files = rest
  if (currentFile === filename) {
    currentFile = null
  }
  persistDeleteCommand(filename)
  notify()
}

export const renameFile = (oldName: string, newName: string): void => {
  const content = files[oldName]
  if (content === undefined) return

  renameInDefinitionIndex(oldName, newName)
  const { [oldName]: _, ...rest } = files
  files = { ...rest, [newName]: content }

  if (currentFile === oldName) {
    currentFile = newName
  }
  persistRenameCommand(oldName, newName)
  notify()
}

export const resolvePendingRefsInBulk = (): void => {
  const definitions = getAllDefinitions()
  let updated = files

  for (const [path, content] of Object.entries(updated)) {
    const marked = markPendingRefs(content, definitions)
    if (marked !== content) {
      updated = { ...updated, [path]: marked }
    }
  }

  if (updated !== files) {
    files = updated
    notify()
  }
}

// Boot diagnostic: after initial file load settles, any remaining #[id] markers are cross-file
// refs whose definitions never arrived. Log-only — pending-refs will still resolve them if the
// definition shows up later (e.g. future multiplayer push). Cross-file existence enforcement
// is intentionally NOT done in schema; this is the single visibility point.
export const auditPendingRefsAtBoot = (): void => {
  const orphans = findOrphanPendingRefs(files)
  for (const { file, ids } of orphans) {
    console.warn(`[refs] orphaned at boot in ${file}:`, ids)
  }
}

export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const hasAllRequiredFiles = (): boolean => REQUIRED_FILES.every((f) => f in files)

export const waitForRequiredFiles = (timeoutMs = 30_000): Promise<void> => {
  if (hasAllRequiredFiles()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub()
      const missing = REQUIRED_FILES.filter((f) => !(f in files))
      reject(new Error(`Required files missing after ${timeoutMs}ms: ${missing.join(", ")}`))
    }, timeoutMs)
    const unsub = subscribe(() => {
      if (hasAllRequiredFiles()) {
        clearTimeout(timer)
        unsub()
        resolve()
      }
    })
  })
}
