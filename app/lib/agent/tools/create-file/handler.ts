import { tool, registerTool, ok, err } from "../../executors/tool"
import { createFile as def } from "./def"
import { normalizeFilename } from "~/lib/files/filename"
import { findFenceCreations, formatFenceCreations } from "~/lib/patch/block-overlap"

const _createFile = registerTool(
  tool({
    ...def,
    handler: async (files, { path, content }) => {
      const storable = normalizeFilename(path)
      if (files.has(storable)) return err(`${storable}: already exists. Use edit_file to modify it`)

      const fenceCreations = findFenceCreations(content)
      if (fenceCreations.length > 0) return err(formatFenceCreations(fenceCreations))

      return ok(`Created ${storable}`, [{ type: "write_file", path: storable, content }])
    },
  })
)
