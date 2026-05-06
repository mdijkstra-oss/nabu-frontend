import { tool, registerTool, ok, err } from "../../executors/tool"
import { copyFile as def } from "./def"
import { getFile } from "~/lib/files/store"

const _copyFile = registerTool(
  tool({
    ...def,
    handler: async (files, { source, destination }) => {
      const content = getFile(source)
      if (content === undefined) return err(`${source}: No such file`)
      if (files.has(destination)) return err(`${destination}: already exists`)

      return ok(`Copied ${source} → ${destination}`, [
        { type: "write_file", path: destination, content },
      ])
    },
  })
)
