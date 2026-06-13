import { describe, it, expect, afterEach } from "vitest"
import { createExecutor } from "../../executors/execute"
import { getToolHandlers } from "../../executors/tool"
import "./handler"
import { setFiles, getFile } from "~/lib/files/store"
import { clearEntries } from "~/lib/mutation-history/store"

const executor = createExecutor(getToolHandlers())

const annotationsFile = `# Doc

Hello world prose.

\`\`\`json-annotations
{
\t"annotations": [
\t\t{ "id": "ann_1", "text": "Hello world", "reason": "key", "color": "blue" }
\t]
}
\`\`\`

More prose follows. Hello world prose appears twice now.
`

const proseFile = `# Persconferentie

De minister kondigde aan dat er stappen worden genomen.

Het tekort loopt op tot 68 miljard euro in 2024.

We zullen werken aan herstel.
`

const cleanup = () => {
  setFiles({})
  clearEntries()
}

type Match =
  | { type: "full_anchor"; anchor: string }
  | { type: "spanned_anchor"; anchor_start: string; anchor_end: string }

const full = (anchor: string): Match => ({ type: "full_anchor", anchor })
const spanned = (anchor_start: string, anchor_end: string): Match => ({
  type: "spanned_anchor",
  anchor_start,
  anchor_end,
})

describe("edit_file", () => {
  afterEach(cleanup)

  interface Case {
    name: string
    files: Record<string, string>
    args: { path: string; match: Match; replacement: string }
    expected:
      | {
          status: "ok"
          checkPath?: string
          contentMatch?: string | RegExp
          contentNotMatch?: string | RegExp
        }
      | { status: "error"; errorMatch: string | RegExp }
  }

  const cases: Case[] = [
    {
      name: "full_anchor: exact substring replace in prose",
      files: { "doc.md": proseFile },
      args: {
        path: "doc.md",
        match: full("stappen worden genomen"),
        replacement: "maatregelen volgen",
      },
      expected: {
        status: "ok",
        contentMatch: "maatregelen volgen",
        contentNotMatch: "stappen worden genomen",
      },
    },
    {
      name: "full_anchor: token-strict fallback when punctuation differs",
      files: { "doc.md": proseFile },
      args: {
        path: "doc.md",
        match: full("het tekort loopt op"),
        replacement: "Het tekort daalde naar nul",
      },
      expected: { status: "ok", contentMatch: "Het tekort daalde naar nul" },
    },
    {
      name: "full_anchor: missing → error",
      files: { "doc.md": proseFile },
      args: { path: "doc.md", match: full("ontbrekende zin xyz"), replacement: "anything" },
      expected: { status: "error", errorMatch: /not found/ },
    },
    {
      name: "full_anchor: ambiguous → error",
      files: { "doc.md": annotationsFile },
      args: { path: "doc.md", match: full("Hello world"), replacement: "Hi" },
      expected: { status: "error", errorMatch: /matches 2 locations/ },
    },
    {
      name: "spanned_anchor: range replace",
      files: { "doc.md": proseFile },
      args: {
        path: "doc.md",
        match: spanned("Het tekort loopt op", "in 2024."),
        replacement: "De begroting is op orde",
      },
      expected: {
        status: "ok",
        contentMatch: "De begroting is op orde",
        contentNotMatch: "68 miljard",
      },
    },
    {
      name: "spanned_anchor: anchor_end missing → error",
      files: { "doc.md": proseFile },
      args: {
        path: "doc.md",
        match: spanned("We zullen werken aan herstel.", "niet bestaande zin"),
        replacement: "x",
      },
      expected: { status: "error", errorMatch: /anchor_end not found/ },
    },
    {
      name: "full_anchor only present inside json block → not found",
      files: { "doc.md": annotationsFile },
      args: {
        path: "doc.md",
        match: full('"reason": "key"'),
        replacement: '"reason": "changed"',
      },
      expected: { status: "error", errorMatch: /not found/ },
    },
    {
      name: "prose phrase that also appears in annotations JSON: resolves uniquely to prose",
      files: {
        "doc.md":
          '# Doc\n\nDe minister kondigde aan dat er stappen worden genomen.\n\n```json-annotations\n{\n\t"annotations": [\n\t\t{ "id": "ann_1", "text": "De minister kondigde aan dat er stappen worden genomen", "reason": "key", "color": "blue" }\n\t]\n}\n```\n',
      },
      args: {
        path: "doc.md",
        match: full("De minister kondigde aan dat er stappen worden genomen."),
        replacement: "De minister herhaalde dat er maatregelen volgen.",
      },
      expected: {
        status: "ok",
        contentMatch: "De minister herhaalde dat er maatregelen volgen.",
        contentNotMatch:
          /De minister kondigde aan dat er stappen worden genomen\.\n\nDe minister kondigde/,
      },
    },
    {
      name: "replacement adds json fence → error",
      files: { "doc.md": proseFile },
      args: {
        path: "doc.md",
        match: full("We zullen werken aan herstel."),
        replacement: "```json-annotations\n{}\n```",
      },
      expected: { status: "error", errorMatch: /Cannot create.*json-annotations/ },
    },
    {
      name: "missing file → error",
      files: {},
      args: { path: "missing.md", match: full("x"), replacement: "y" },
      expected: { status: "error", errorMatch: /No such file/ },
    },
    {
      name: "empty replacement deletes the span",
      files: { "doc.md": proseFile },
      args: {
        path: "doc.md",
        match: full(" in 2024"),
        replacement: "",
      },
      expected: { status: "ok", contentNotMatch: " in 2024" },
    },
  ]

  it.each(cases)("$name", async (c) => {
    setFiles(c.files)
    const result = await executor({ id: "test", name: "edit_file", args: c.args })

    expect(result.status, String(result.output)).toBe(c.expected.status)

    if (c.expected.status === "error") {
      expect(String(result.output)).toMatch(c.expected.errorMatch)
      return
    }

    const checkPath = c.expected.checkPath ?? c.args.path
    const after = getFile(checkPath) ?? ""
    if (c.expected.contentMatch) expect(after).toMatch(c.expected.contentMatch)
    if (c.expected.contentNotMatch) expect(after).not.toMatch(c.expected.contentNotMatch)
  })
})
