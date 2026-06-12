import type { Operation } from "../../types"
import { exhaustive } from "~/lib/utils/exhaustive"
import { tool, registerTool, ok, err, withHint } from "../../executors/tool"
import { applyLocalPatch as def } from "./def"
import { detectHint } from "./hints"
import { isProtectedFile } from "~/lib/files/filename"
import {
  detectBlockTouches,
  formatBlockTouchErrors,
  detectBlockCreations,
  formatBlockCreationErrors,
} from "./block-guard"

const _applyLocalPatch = registerTool(
  tool({
    ...def,
    includeAppliedDiff: true,
    handler: async (files, { operation }) => {
      const validationError = validateOperation(files, operation)
      if (validationError) return err(validationError)

      if (operation.type === "create_file" || operation.type === "update_file") {
        const creations = detectBlockCreations(operation.diff)
        if (creations.length > 0) return err(formatBlockCreationErrors(creations))
      }

      if (operation.type === "update_file") {
        const fileContent = files.get(operation.path) ?? ""
        const blockTouches = detectBlockTouches(fileContent, operation.diff)
        if (blockTouches.length > 0) return err(formatBlockTouchErrors(blockTouches))
      }

      const result = ok(formatSuccess(operation), [operation])
      const hint =
        operation.type === "update_file"
          ? detectHint({ fileContent: files.get(operation.path) ?? "", diff: operation.diff })
          : null
      return withHint(result, hint)
    },
  })
)

const validateOperation = (files: Map<string, string>, op: Operation): string | null => {
  switch (op.type) {
    case "create_file":
      return files.has(op.path) ? `${op.path}: already exists. Use update_file to modify it` : null
    case "update_file":
      return files.has(op.path) ? null : `${op.path}: No such file`
    case "delete_file":
      if (isProtectedFile(op.path)) return `${op.path}: protected file, cannot be deleted`
      return files.has(op.path) ? null : `${op.path}: No such file`
    case "write_file":
      return `write_file is not a valid LLM operation`
    case "rename_file":
      if (isProtectedFile(op.path)) return `${op.path}: protected file, cannot be renamed`
      if (!files.has(op.path)) return `${op.path}: No such file`
      if (files.has(op.newPath)) return `${op.newPath}: already exists`
      return null
    default:
      return exhaustive(op)
  }
}

const operationVerb: Record<Operation["type"], string> = {
  create_file: "Created",
  update_file: "Updated",
  write_file: "Wrote",
  delete_file: "Deleted",
  rename_file: "Renamed",
}

const formatSuccess = (op: Operation): string =>
  op.type === "rename_file"
    ? `Renamed ${op.path} → ${op.newPath}`
    : `${operationVerb[op.type]} ${op.path}`
