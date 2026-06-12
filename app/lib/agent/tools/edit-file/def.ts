import { z } from "zod"

const EditFileArgs = z.object({
  path: z.string().min(1).describe("Path of the file to edit"),
  needle: z
    .string()
    .min(1)
    .describe(
      "Text to find in the file. Must match a unique location (exact substring, or token-strict fallback). Use `...` once to elide the middle of a range — both anchors before/after `...` must each match a unique location."
    ),
  replacement: z
    .string()
    .describe(
      "Text that replaces the matched span. Raw content — no diff prefixes. Newlines are literal. May be empty to delete the span."
    ),
})

export const editFile = {
  name: "edit_file" as const,
  description:
    "Find unique text in a file and replace it. Cannot cross or modify JSON block boundaries — use `patch_<type>` / `add_<type>` / `delete_<type>` for those.\n\nMatching: exact substring first; if not found, falls back to a token-strict match (case-insensitive, punctuation-/diacritic-insensitive, Unicode-aware). Multiple matches → error: add more context or use `...` to anchor both sides of a range.\n\nparallel: self=same file no, diff files yes / others=with reads yes",
  schema: EditFileArgs,
}
