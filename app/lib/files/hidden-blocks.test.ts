import { describe, it, expect, beforeEach } from "vitest"
import { resolveHiddenFile, resolveGeneratedWrite } from "./hidden-blocks"
import { setFiles } from "./store"

const callout = (id: string, title: string): string =>
  `\`\`\`json-callout\n${JSON.stringify({ id, title, content: `text for ${id}` })}\n\`\`\``

const chart = (id: string, caption: string): string =>
  `\`\`\`json-chart\n${JSON.stringify({ id, caption: { label: caption } })}\n\`\`\``

const wrapLang = (language: string, data: unknown): string =>
  "```" + language + "\n" + JSON.stringify(data, null, 2) + "\n```"

describe("resolveHiddenFile", () => {
  beforeEach(() => {
    setFiles({
      "a.md": `intro\n\n${callout("callout-1abc2def", "Week 1")}\n\n${callout("callout-2bcd3efg", "Week 2")}`,
      "b.md": `${chart("chart-3cde4fgh", "Distribution")}`,
    })
  })

  const cases: {
    name: string
    setup?: Record<string, string>
    path: string
    expected: string | undefined
  }[] = [
    {
      name: "resolves callout by id",
      path: "callout-1abc2def.generated.hidden.md",
      expected: wrapLang("json-callout", {
        id: "callout-1abc2def",
        title: "Week 1",
        content: "text for callout-1abc2def",
      }),
    },
    {
      name: "resolves second callout",
      path: "callout-2bcd3efg.generated.hidden.md",
      expected: wrapLang("json-callout", {
        id: "callout-2bcd3efg",
        title: "Week 2",
        content: "text for callout-2bcd3efg",
      }),
    },
    {
      name: "resolves chart by id",
      path: "chart-3cde4fgh.generated.hidden.md",
      expected: wrapLang("json-chart", {
        id: "chart-3cde4fgh",
        caption: { label: "Distribution" },
      }),
    },
    {
      name: "unknown id returns undefined",
      path: "callout-9xxx9xxx.generated.hidden.md",
      expected: undefined,
    },
    {
      name: "non-hidden path returns undefined",
      path: "a.md",
      expected: undefined,
    },
    {
      name: "empty store returns undefined",
      setup: {},
      path: "callout-1abc2def.generated.hidden.md",
      expected: undefined,
    },
  ]

  it.each(cases)("$name", ({ setup, path, expected }) => {
    if (setup !== undefined) setFiles(setup)
    expect(resolveHiddenFile(path)).toEqual(expected)
  })
})

describe("resolveGeneratedWrite", () => {
  beforeEach(() => {
    setFiles({
      "a.md": `intro\n\n${callout("callout-1abc2def", "Week 1")}\n\nend`,
    })
  })

  const cases: {
    name: string
    path: string
    newContent: string
    expected: { realPath: string; realContent: string } | undefined
  }[] = [
    {
      name: "replaces block content in real file",
      path: "callout-1abc2def.generated.hidden.md",
      newContent: JSON.stringify({ id: "callout-1abc2def", title: "Updated", content: "new" }),
      expected: {
        realPath: "a.md",
        realContent: `intro\n\n\`\`\`json-callout\n${JSON.stringify({ id: "callout-1abc2def", title: "Updated", content: "new" })}\n\`\`\`\n\nend\n`,
      },
    },
    {
      name: "unknown id returns undefined",
      path: "callout-9xxx9xxx.generated.hidden.md",
      newContent: "{}",
      expected: undefined,
    },
    {
      name: "non-generated path returns undefined",
      path: "a.md",
      newContent: "{}",
      expected: undefined,
    },
  ]

  it.each(cases)("$name", ({ path, newContent, expected }) => {
    expect(resolveGeneratedWrite(path, newContent)).toEqual(expected)
  })
})
