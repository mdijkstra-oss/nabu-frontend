import { tool, registerTool, ok, err } from "../../executors/tool"
import { copyFile as def } from "./def"
import { normalizeFilename } from "~/lib/files/filename"
import { getFile } from "~/lib/files/store"

const _copyFile = registerTool(
  tool({
    ...def,
    handler: async (files, { source, destination }) => {
      const content = getFile(source)
      if (content === undefined) return err(`${source}: No such file`)

      const storable = normalizeFilename(destination)
      if (files.has(storable)) return err(`${storable}: already exists`)

      return ok(`Copied ${source} → ${storable}`, [{ type: "write_file", path: storable, content }])
    },
  })
)
