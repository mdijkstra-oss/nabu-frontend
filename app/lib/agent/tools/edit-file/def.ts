import { z } from "zod"

const FullAnchor = z.object({
  type: z.literal("full_anchor"),
  anchor: z
    .string()
    .min(1)
    .describe(
      "Exact text to replace. Must match a unique location in the file (exact substring; falls back to token-strict — case-, punctuation-, diacritic-insensitive, Unicode-aware). The matched span IS what gets replaced."
    ),
})

const SpannedAnchor = z.object({
  type: z.literal("spanned_anchor"),
  anchor_start: z
    .string()
    .min(1)
    .describe(
      "Text marking the start of the span. Matched uniquely in the file. Anchor is INSIDE the replaced span — include it in `replacement` if you want it preserved."
    ),
  anchor_end: z
    .string()
    .min(1)
    .describe(
      "Text marking the end of the span. Matched uniquely AFTER `anchor_start`. Anchor is INSIDE the replaced span — include it in `replacement` if you want it preserved."
    ),
})

const EditFileArgs = z.object({
  path: z.string().min(1).describe("Path of the file to edit"),
  match: z
    .discriminatedUnion("type", [FullAnchor, SpannedAnchor])
    .describe(
      "How to locate the edit. Use `full_anchor` when you have the exact text to replace. Use `spanned_anchor` when you want to replace a range and only the edges are easy to quote unambiguously."
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
    "Find a unique span in a file and replace it. Cannot cross or modify JSON block boundaries — use `patch_<type>` / `add_<type>` / `delete_<type>` for those.\n\nMatch shapes:\n- `full_anchor`: the anchor text IS the replaced span.\n- `spanned_anchor`: the replaced span runs from the start of `anchor_start` through the end of `anchor_end`; both anchors are included in the span (not preserved).\n\nMatching: exact substring first; on miss, token-strict (case-, punctuation-, diacritic-insensitive, Unicode-aware). Ambiguous matches → error with line context.\n\nparallel: self=same file no, diff files yes / others=with reads yes",
  schema: EditFileArgs,
}
