import { z } from "zod"
import type { AnyTool } from "../../executors/tool"
import { normalizeLlmSql } from "~/lib/sql/normalize"
import { SQL_ARG_DESCRIPTION } from "../sql-describe"

export const SearchArgs = z.object({
  title: z
    .string()
    .describe("Short 2-4 word label, e.g. 'Interview documents', 'Frustration mentions'"),
  description: z.string().describe("Human-readable summary of what was searched for"),
  sql: z.string().describe(SQL_ARG_DESCRIPTION).transform(normalizeLlmSql),
  highlight: z
    .string()
    .describe(
      "What to highlight in each result chunk. Describes the relevant passages to extract and show to the user."
    ),
  framework_file: z
    .string()
    .optional()
    .describe(
      "Optional path to a markdown file (e.g. a codebook) used as a coarse pre-filter scope. Chunks judged off-topic against the framework are dropped before semantic matching. Omit for ad-hoc search."
    ),
})

export const searchTool: AnyTool = {
  name: "search",
  description:
    "Search the project database and persist results as a browsable page the user can revisit. Not for counting or aggregation — use query for those.\n\nparallel: no — user-facing interaction",
  schema: SearchArgs,
}
