import { createPatch } from "diff"
import type { ToolCall } from "../client/blocks"
import { exhaustive } from "~/lib/utils/exhaustive"
import type { ToolResult, Operation, Handler } from "../types"
import { getFileRaw, updateFileRaw, deleteFile, renameFile } from "~/lib/files/store"
import { finalizeContent } from "~/lib/patch/apply"
import { formatGeneratedIds } from "~/lib/data-blocks/uuid"
import { isHiddenFile, isGeneratedHiddenFile, SETTINGS_FILE } from "~/lib/files/filename"
import { resolveGeneratedWrite } from "~/lib/files/hidden-blocks"
import { parseCodeBlocks } from "~/lib/data-blocks/parse"
import { validateBlocksAsync, formatValidationErrors } from "~/lib/data-blocks/validate"
import type { ToolExecutor } from "../turn"
import { pushEntries } from "~/lib/mutation-history/store"
import { diffFileContent, fileDeletedEntry, fileRenamedEntry } from "~/lib/mutation-history/diff"
import { getViewableFiles } from "../tools/file-view"
import { getToolMeta } from "./tool"

interface MutationOk {
  ids: string | null
  warnings?: string
  applied?: string
}
interface MutationErr {
  error: string
}
type MutationResult = MutationOk | MutationErr

const buildAppliedDiff = (
  path: string,
  oldContent: string,
  newContent: string
): string | undefined => {
  if (oldContent === newContent) return undefined
  const patch = createPatch(path, oldContent, newContent)
  return patch.includes("\n@@") ? patch : undefined
}

const runAsyncValidation = async (path: string, content: string): Promise<MutationErr | null> => {
  const asyncResult = await validateBlocksAsync(content, { path })
  if (!asyncResult.valid) return { error: formatValidationErrors(asyncResult.errors) }
  return null
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

const applyMutation = async (op: Operation): Promise<MutationResult> => {
  const redirected = redirectGeneratedOp(op)
  if ("error" in redirected) return redirected as MutationErr
  const hiddenErr = checkHiddenFileGuard(redirected)
  if (hiddenErr) return hiddenErr
  const ts = Date.now()
  switch (redirected.type) {
    case "write_file": {
      const oldContent = getFileRaw(redirected.path)
      const skipBlockValidation = redirected.skipBlockValidation === true
      const result = finalizeContent(redirected.path, redirected.content, {
        original: oldContent,
        actor: "ai",
        skipImmutableCheck: skipBlockValidation,
        skipSemanticValidation: skipBlockValidation,
        skipBlockValidation,
      })
      if (result.status === "error") return { error: result.error }

      if (!skipBlockValidation) {
        const asyncError = await runAsyncValidation(redirected.path, result.content)
        if (asyncError) return asyncError
      }

      updateFileRaw(result.path, result.content)
      pushEntries(diffFileContent(oldContent, result.content, redirected.path, ts))
      const ids = result.generatedIds ? formatGeneratedIds(result.generatedIds) : null
      const warnings = result.status === "partial" ? result.warnings : undefined
      const applied = buildAppliedDiff(result.path, oldContent ?? "", result.content)
      return { ids, warnings, applied }
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

const isMutationError = (r: MutationResult): r is MutationErr => "error" in r

const applyMutations = async (mutations: Operation[]): Promise<MutationErr | MutationOk | null> => {
  if (mutations.length === 0) return null
  const allIds: string[] = []
  const allWarnings: string[] = []
  const allApplied: string[] = []
  for (const op of mutations) {
    const result = await applyMutation(op)
    if (isMutationError(result)) return result
    if (result.ids) allIds.push(result.ids)
    if (result.warnings) allWarnings.push(result.warnings)
    if (result.applied) allApplied.push(result.applied)
  }
  return {
    ids: allIds.length > 0 ? allIds.join("\n") : null,
    warnings: allWarnings.length > 0 ? allWarnings.join("\n") : undefined,
    applied: allApplied.length > 0 ? allApplied.join("\n") : undefined,
  }
}

const appendIds = (output: unknown, ids: string | null): unknown =>
  ids && typeof output === "string" ? `${output}\n${ids}` : output

const appendApplied = (output: unknown, applied: string | undefined): unknown =>
  applied && typeof output === "string" ? `${output}\n\nApplied:\n${applied}` : output

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

    const withIds = appendIds(output, mutResult?.ids ?? null)
    const meta = getToolMeta(call.name)
    const finalOutput = meta.includeAppliedDiff
      ? appendApplied(withIds, mutResult?.applied)
      : withIds
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
