import { parseV4ADiff, applyHunks } from "./parse"
import type { Hunk } from "./parse"

export type FieldDiffResult = { ok: true; content: string } | { ok: false; error: string }

const FIELD_MIN_CONTEXT_LINES = 1

const unescapeJsonEscapes = (s: string): string => s.replace(/\\n/g, "\n").replace(/\\t/g, "\t")

const trimPartTrailing = (content: string): string =>
  content.replace(/\n$/, "").replace(/[ \t]+$/, "") + "\n"

const normalizeFieldHunk = (hunk: Hunk): Hunk => ({
  parts: hunk.parts.map((p) => ({ ...p, content: trimPartTrailing(p.content) })),
})

export const applyFieldDiff = (value: string, diff: string): FieldDiffResult =>
  applyHunks(
    value,
    parseV4ADiff(unescapeJsonEscapes(diff)).map(normalizeFieldHunk),
    FIELD_MIN_CONTEXT_LINES
  )
