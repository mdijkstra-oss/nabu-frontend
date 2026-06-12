import { tool, registerTool, ok, err } from "../../executors/tool"
import { createFile as def } from "./def"
import { findFenceCreations, formatFenceCreations } from "~/lib/patch/block-overlap"

const _createFile = registerTool(
  tool({
    ...def,
    handler: async (files, { path, content }) => {
      if (files.has(path)) return err(`${path}: already exists. Use edit_file to modify it`)

      const fenceCreations = findFenceCreations(content)
      if (fenceCreations.length > 0) return err(formatFenceCreations(fenceCreations))

      return ok(`Created ${path}`, [{ type: "write_file", path, content }])
    },
  })
)
