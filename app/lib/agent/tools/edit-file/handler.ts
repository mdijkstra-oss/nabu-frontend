import { tool, registerTool, ok, err } from "../../executors/tool"
import { editFile as def } from "./def"
import { resolveAnchor, isAnchorError } from "~/lib/text/anchor"
import {
  maskKnownBlocks,
  findFenceCreations,
  formatFenceCreations,
} from "~/lib/patch/block-overlap"
import { stripBoundaryComments } from "~/lib/patch/resolve/json-boundary"

const _editFile = registerTool(
  tool({
    ...def,
    handler: async (files, { path, needle, replacement }) => {
      const view = files.get(path)
      if (view === undefined) return err(`${path}: No such file`)
      const content = stripBoundaryComments(view)

      const span = resolveAnchor(maskKnownBlocks(content), needle)
      if (isAnchorError(span)) return err(`${path}: ${span.error}`)

      const fenceCreations = findFenceCreations(replacement)
      if (fenceCreations.length > 0) return err(formatFenceCreations(fenceCreations))

      const newContent = content.slice(0, span.start) + replacement + content.slice(span.end)

      return ok(`Edited ${path}`, [{ type: "write_file", path, content: newContent }])
    },
  })
)
