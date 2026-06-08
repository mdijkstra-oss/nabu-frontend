import { z } from "zod"
import type { AnyTool } from "../../executors/tool"
import { FileEntry, TOO_MANY_FILES_NUDGE } from "../file-entry"

export const ScoutArgs = z.object({
  files: z.array(FileEntry).max(40, TOO_MANY_FILES_NUDGE).describe("Files involved in the task."),
})

export type ScoutFileEntry = FileEntry

export const scoutTool: AnyTool = {
  name: "scout",
  description:
    "NOT for interpretive work (coding, framework application, evaluation) — use apply_deep_analysis for those. This tool maps file prose into sections for mechanical/structural tasks (translate, reformat, extract).\n\nSmall files are inlined.\n\nparallel: no — batches internally (accepts array), wait for results before acting",
  schema: ScoutArgs,
}
