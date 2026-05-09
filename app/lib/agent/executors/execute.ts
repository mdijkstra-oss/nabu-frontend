import type { ToolCall } from "../client/blocks"
import { exhaustive } from "~/lib/utils/exhaustive"
import type { ToolResult, Operation, Handler } from "../types"
import { getFileRaw, updateFileRaw, deleteFile, renameFile } from "~/lib/files/store"
import { applyFilePatch, finalizeContent } from "~/lib/patch/apply"
import { formatGeneratedIds } from "~/lib/data-blocks/uuid"
import { isHiddenFile, isGeneratedHiddenFile, SETTINGS_FILE } from "~/lib/files/filename"
import { resolveGeneratedWrite } from "~/lib/files/hidden-blocks"
import { parseCodeBlocks } from "~/lib/data-blocks/parse"
import { replaceUuidPlaceholders } from "~/lib/data-blocks/uuid"
import { validateBlocksAsync, formatValidationErrors } from "~/lib/data-blocks/validate"
import type { ToolExecutor } from "../turn"
import { pushEntries } from "~/lib/mutation-history/store"
import {
  diffFileContent,
  fileCreatedEntry,
  fileDeletedEntry,
  fileRenamedEntry,
} from "~/lib/mutation-history/diff"
import { getViewableFiles } from "../tools/file-view"

interface ResolvedOp {
  op: Operation
  placeholderIds: Record<string, string>
}

const resolveOpPlaceholders = (op: Operation): ResolvedOp => {
  if (!("diff" in op)) return { op, placeholderIds: {} }
  const { result, generated } = replaceUuidPlaceholders(op.diff)
  return { op: { ...op, diff: result }, placeholderIds: generated }
}

interface PatchOptions {
  skipImmutableCheck?: boolean
  placeholderIds?: Record<string, string>
}

interface MutationOk {
  ids: string | null
  warnings?: string
}
interface MutationErr {
  error: string
}
type MutationResult = MutationOk | MutationErr

const isMutationError = (r: MutationResult): r is MutationErr => "error" in r

const runAsyncValidation = async (path: string, content: string): Promise<MutationErr | null> => {
  const asyncResult = await validateBlocksAsync(content, { path })
  if (!asyncResult.valid) return { error: formatValidationErrors(asyncResult.errors) }
  return null
}

const applyPatchAndStore = async (
  path: string,
  content: string,
  diff: string,
  options: PatchOptions
): Promise<MutationResult> => {
  const result = applyFilePatch(path, content, diff, { ...options, actor: "ai" })
  if (result.status === "error") return { error: result.error }

  const asyncError = await runAsyncValidation(path, result.content)
  if (asyncError) return asyncError

  updateFileRaw(result.path, result.content)
  const ids = result.generatedIds ? formatGeneratedIds(result.generatedIds) : null
  const warnings = result.status === "partial" ? result.warnings : undefined
  return { ids, warnings }
}

const isWritableByAi = (path: string): boolean => !isHiddenFile(path) || path === SETTINGS_FILE

const mutationPaths = (op: Operation): string[] =>
  op.type === "rename_file" ? [op.path, op.newPath] : [op.path]

const checkHiddenFileGuard = (op: Operation): MutationErr | null => {
  const blocked = mutationPaths(op).find((p) => !isWritableByAi(p))
  return blocked ? { error: `${blocked}: hidden file, cannot be modified by the assistant` } : null
}

const redirectGeneratedOp = (op: Operation): Operation | MutationErr => {
  const targetPath = op.type === "rename_file" ? op.path : op.path
  if (!isGeneratedHiddenFile(targetPath)) return op

  if (op.type !== "write_file")
    return { error: `${op.path}: generated file — use write_file to modify` }

  const blocks = parseCodeBlocks(op.content)
  if (blocks.length === 0) return { error: `${op.path}: no code block found in content` }

  const result = resolveGeneratedWrite(op.path, blocks[0].content)
  if (!result) return { error: `${op.path}: could not resolve generated file to source` }

  return { ...op, path: result.realPath, content: result.realContent }
}

const applyMutation = async (
  op: Operation,
  placeholderIds: Record<string, string>
): Promise<MutationResult> => {
  const redirected = redirectGeneratedOp(op)
  if ("error" in redirected) return redirected as MutationErr
  const hiddenErr = checkHiddenFileGuard(redirected)
  if (hiddenErr) return hiddenErr
  const ts = Date.now()
  switch (redirected.type) {
    case "create_file": {
      if (getFileRaw(redirected.path))
        return { error: `${redirected.path}: already exists. Use update_file to modify it` }
      const result = await applyPatchAndStore(redirected.path, "", redirected.diff, {
        placeholderIds,
      })
      if (!isMutationError(result)) {
        const newContent = getFileRaw(redirected.path) ?? ""
        pushEntries([
          fileCreatedEntry(redirected.path, ts),
          ...diffFileContent("", newContent, redirected.path, ts),
        ])
      }
      return result
    }
    case "update_file": {
      const oldContent = getFileRaw(redirected.path)
      if (!oldContent) return { error: `${redirected.path}: No such file` }
      const result = await applyPatchAndStore(redirected.path, oldContent, redirected.diff, {
        skipImmutableCheck: redirected.skipImmutableCheck,
        placeholderIds,
      })
      if (!isMutationError(result)) {
        const newContent = getFileRaw(redirected.path) ?? ""
        pushEntries(diffFileContent(oldContent, newContent, redirected.path, ts))
      }
      return result
    }
    case "write_file": {
      const oldContent = getFileRaw(redirected.path)
      const result = finalizeContent(redirected.path, redirected.content, {
        original: oldContent,
        actor: "ai",
        skipImmutableCheck: redirected.skipBlockValidation,
        skipCodeValidation: redirected.skipBlockValidation,
      })
      if (result.status === "error") return { error: result.error }

      const asyncError = await runAsyncValidation(redirected.path, result.content)
      if (asyncError) return asyncError

      updateFileRaw(result.path, result.content)
      pushEntries(diffFileContent(oldContent, result.content, redirected.path, ts))
      const ids = result.generatedIds ? formatGeneratedIds(result.generatedIds) : null
      const warnings = result.status === "partial" ? result.warnings : undefined
      return { ids, warnings }
    }
    case "delete_file": {
      const oldContent = getFileRaw(redirected.path)
      if (!oldContent) return { error: `${redirected.path}: No such file` }
      pushEntries([
        ...diffFileContent(oldContent, "", redirected.path, ts),
        fileDeletedEntry(redirected.path, ts),
      ])
      deleteFile(redirected.path)
      return { ids: null }
    }
    case "rename_file": {
      if (!getFileRaw(redirected.path)) return { error: `${redirected.path}: No such file` }
      if (getFileRaw(redirected.newPath)) return { error: `${redirected.newPath}: already exists` }
      renameFile(redirected.path, redirected.newPath)
      pushEntries([fileRenamedEntry(redirected.path, redirected.newPath, ts)])
      return { ids: null }
    }
    default:
      return exhaustive(redirected)
  }
}

const applyMutations = async (mutations: Operation[]): Promise<MutationErr | MutationOk | null> => {
  if (mutations.length === 0) return null
  const allIds: string[] = []
  const allWarnings: string[] = []
  for (const op of mutations) {
    const { op: resolved, placeholderIds } = resolveOpPlaceholders(op)
    const result = await applyMutation(resolved, placeholderIds)
    if (isMutationError(result)) return result
    if (result.ids) allIds.push(result.ids)
    if (result.warnings) allWarnings.push(result.warnings)
  }
  return {
    ids: allIds.length > 0 ? allIds.join("\n") : null,
    warnings: allWarnings.length > 0 ? allWarnings.join("\n") : undefined,
  }
}

const appendIds = (output: unknown, ids: string | null): unknown =>
  ids && typeof output === "string" ? `${output}\n${ids}` : output

export const createExecutor =
  (handlers: Record<string, Handler>): ToolExecutor =>
  async (call: ToolCall): Promise<ToolResult<unknown>> => {
    const handler = handlers[call.name]
    if (!handler) return { status: "error", output: `Unknown tool: ${call.name}` }

    const files = getViewableFiles()
    const { status, output, message, hint, directive, mutations } = await handler(files, call.args)

    const mutResult = await applyMutations(mutations)
    if (mutResult && isMutationError(mutResult))
      return { status: "error", output: mutResult.error, hint, directive }

    const finalOutput = appendIds(output, mutResult?.ids ?? null)
    const finalStatus = mutResult?.warnings ? "partial" : status
    const finalMessage = mutResult?.warnings
      ? [message, mutResult.warnings].filter(Boolean).join("\n")
      : message
    return {
      status: finalStatus,
      output: finalOutput,
      message: finalMessage,
      hint,
      directive,
    } as ToolResult<unknown>
  }
