import { tool, registerTool, ok, err } from "../../executors/tool"
import { editFile as def } from "./def"
import {
  resolveAnchor,
  resolveAnchorRange,
  isAnchorError,
  type AnchorResolution,
} from "~/lib/text/anchor"
import {
  maskKnownBlocks,
  findFenceCreations,
  formatFenceCreations,
} from "~/lib/patch/block-overlap"
import { stripBoundaryComments } from "~/lib/patch/resolve/json-boundary"

type Match =
  | { type: "full_anchor"; anchor: string }
  | { type: "spanned_anchor"; anchor_start: string; anchor_end: string }

const resolveMatch = (masked: string, match: Match): AnchorResolution => {
  if (match.type === "full_anchor") return resolveAnchor(masked, match.anchor)
  return resolveAnchorRange(masked, match.anchor_start, match.anchor_end)
}

const _editFile = registerTool(
  tool({
    ...def,
    handler: async (files, { path, match, replacement }) => {
      const view = files.get(path)
      if (view === undefined) return err(`${path}: No such file`)
      const content = stripBoundaryComments(view)

      const span = resolveMatch(maskKnownBlocks(content), match)
      if (isAnchorError(span)) return err(`${path}: ${span.error}`)

      const fenceCreations = findFenceCreations(replacement)
      if (fenceCreations.length > 0) return err(formatFenceCreations(fenceCreations))

      const newContent = content.slice(0, span.start) + replacement + content.slice(span.end)

      return ok(`Edited ${path}`, [
        { type: "write_file", path, content: newContent, skipBlockValidation: true },
      ])
    },
  })
)
