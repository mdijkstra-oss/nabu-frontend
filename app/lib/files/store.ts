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
} from "./pending-refs"
import { resolveHiddenFile } from "./hidden-blocks"
import { countLines } from "~/lib/text/stats"
import { debounce, createScopedDebounce } from "~/lib/utils/debounce"
import { sendCommand } from "~/lib/server/sync/commands"
import { normalizeContent as normalize } from "~/lib/patch/diff/normalize"
import { normalizeSingletonOrder } from "~/lib/data-blocks/normalize"

const normalizeFile = (text: string): string => normalizeSingletonOrder(normalize(text)) + "\n"
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

const persistWrite = (path: string): void => {
  if (!projectId || !persistEnabled || persistSuppressed) return
  const pid = projectId
  persistDebounce.call(path, async () => {
    const content = files[path]
    if (content === undefined) return
    await sendCommand(pid, { action: "WriteFile", path, content })
  })
}

const persistDeleteCommand = (path: string): void => {
  if (!projectId || !persistEnabled || persistSuppressed) return
  persistDebounce.cancel(path)
  sendCommand(projectId, { action: "DeleteFile", path }).catch(() => undefined)
}

const persistRenameCommand = (oldPath: string, newPath: string): void => {
  if (!projectId || !persistEnabled || persistSuppressed) return
  persistDebounce.cancel(oldPath)
  sendCommand(projectId, { action: "RenameFile", path: oldPath, newPath }).catch(() => undefined)
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
  console.debug(`[store] setFiles: ${Object.keys(newFiles).length} files`, Object.keys(newFiles))
  files = Object.fromEntries(Object.entries(newFiles).map(([k, v]) => [k, normalizeFile(v)]))
  rebuildDefinitionIndex(files)
  notify()
}

export const setCurrentFile = (filename: string | null): void => {
  currentFile = filename
  notify()
}

export interface UpdateFileOptions {
  immediate?: boolean
}

export const updateFileRaw = (filename: string, raw: string, options?: UpdateFileOptions): void => {
  const normalized = normalizeFile(raw)
  if (normalized === files[filename]) return
  const isNew = !(filename in files)
  console.debug(
    `[store] updateFileRaw: ${isNew ? "create" : "update"} "${filename}" (${normalized.length} chars)`
  )

  const scheduleNotify = options?.immediate ? notify : debouncedNotify

  updateDefinitionIndex(filename, normalized)

  if (pendingRefsSuppressed) {
    files = { ...files, [filename]: normalized }
    persistWrite(filename)
    scheduleNotify()
    return
  }

  const definitions = getAllDefinitions()
  const marked = markPendingRefs(normalized, definitions)
  const pendingRefsInNew = findPendingRefs(marked)
  if (pendingRefsInNew.length > 0) {
    console.debug(`[store] marked ${pendingRefsInNew.length} pending refs in "${filename}"`)
  }

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

  if (resolvedPaths.length > 0) {
    console.debug(`[store] resolved ${resolvedPaths.length} pending refs`)
  }

  files = updatedFiles
  persistWrite(filename)
  for (const path of resolvedPaths) persistWrite(path)
  scheduleNotify()
}

export const deleteFile = (filename: string): void => {
  console.debug(`[store] deleteFile: "${filename}"`)
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
  console.debug(`[store] renameFile: "${oldName}" -> "${newName}"`)
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
    const count = Object.keys(updated).filter((k) => updated[k] !== files[k]).length
    console.debug(`[store] bulk pending refs: marked ${count} files`)
    files = updated
    notify()
  }
}

export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
