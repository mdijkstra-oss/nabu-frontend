import { describe, expect, it } from "vitest"
import { block } from "./test-helpers"
import {
  normalizeSingletonOrder,
  normalizeBlockFields,
  normalizeBlockKeyOrder,
  expandBlockIdRefs,
} from "./normalize"

const calloutJson = (content: string): string =>
  JSON.stringify({
    id: "c1",
    type: "codebook-code",
    title: "Test",
    content,
    color: "blue",
    collapsed: false,
  })

const calloutJsonPretty = (content: string): string =>
  JSON.stringify(
    {
      id: "c1",
      type: "codebook-code",
      title: "Test",
      content,
      color: "blue",
      collapsed: false,
    },
    null,
    "\t"
  )

describe("normalizeBlockFields", () => {
  const cases = [
    {
      name: "normalizes list markers in callout content",
      input: `# Prose\n\n${block("json-callout", calloutJson("- first\n  - second"))}`,
      expected: `# Prose\n\n${block("json-callout", calloutJsonPretty("* first\n\t* second"))}`,
    },
    {
      name: "normalizes spaces to tabs in callout content",
      input: block("json-callout", calloutJson("  indented\n    deeper")),
      expected: block("json-callout", calloutJsonPretty("\tindented\n\t\tdeeper")),
    },
    {
      name: "leaves non-callout blocks unchanged",
      input: block("json-attributes", '{"type":"research","subject":"AI"}'),
      expected: block("json-attributes", '{"type":"research","subject":"AI"}'),
    },
    {
      name: "leaves already-normalized content unchanged",
      input: block("json-callout", calloutJsonPretty("* item\n\t* child")),
      expected: block("json-callout", calloutJsonPretty("* item\n\t* child")),
    },
    {
      name: "preserves prose around blocks",
      input: `# Title\n\nProse\n\n${block("json-callout", calloutJson("- item"))}\n\nMore prose`,
      expected: `# Title\n\nProse\n\n${block("json-callout", calloutJsonPretty("* item"))}\n\nMore prose`,
    },
    {
      name: "no blocks — unchanged",
      input: "# Just prose",
      expected: "# Just prose",
    },
  ]

  it.each(cases)("$name", (c) => {
    expect(normalizeBlockFields(c.input)).toBe(c.expected)
  })

  it("is idempotent", () => {
    const input = block("json-callout", calloutJson("- first\n  - second"))
    const once = normalizeBlockFields(input)
    const twice = normalizeBlockFields(once)
    expect(twice).toBe(once)
  })
})

describe("normalizeSingletonOrder", () => {
  interface Case {
    name: string
    input: string
    expected: string
  }

  const attrs = block("json-attributes", '{"type":"research","subject":"AI"}')
  const annotations = block("json-annotations", '[{"id":"a1","text":"note"}]')
  const settings = block("json-settings", '{"tags":[]}')
  const callout = block("json-callout", '{"id":"c1","title":"Tip"}')
  const chart = block("json-chart", '{"id":"ch1"}')

  const cases: Case[] = [
    {
      name: "no singletons — unchanged",
      input: `# Title\n\nSome prose\n\n${callout}`,
      expected: `# Title\n\nSome prose\n\n${callout}`,
    },
    {
      name: "singleton already at end — unchanged order",
      input: `# Title\n\nProse\n\n${attrs}`,
      expected: `# Title\n\nProse\n\n${attrs}`,
    },
    {
      name: "singleton in middle moves to end",
      input: `# Title\n\n${attrs}\n\nMore prose`,
      expected: `# Title\n\nMore prose\n\n${attrs}`,
    },
    {
      name: "multiple singletons reordered to registry order (attrs, settings, annotations)",
      input: `# Title\n\n${annotations}\n\nMiddle\n\n${attrs}`,
      expected: `# Title\n\nMiddle\n\n${attrs}\n\n${annotations}`,
    },
    {
      name: "all three singletons in wrong order",
      input: `${annotations}\n\n# Title\n\n${settings}\n\nProse\n\n${attrs}`,
      expected: `# Title\n\nProse\n\n${attrs}\n\n${settings}\n\n${annotations}`,
    },
    {
      name: "non-singleton blocks stay in place",
      input: `# Title\n\n${attrs}\n\n${callout}\n\n${chart}\n\nEnd`,
      expected: `# Title\n\n${callout}\n\n${chart}\n\nEnd\n\n${attrs}`,
    },
    {
      name: "singleton between non-singletons preserves non-singleton order",
      input: `${callout}\n\n${annotations}\n\n${chart}`,
      expected: `${callout}\n\n${chart}\n\n${annotations}`,
    },
    {
      name: "only singletons — prose is empty",
      input: `${attrs}\n\n${annotations}`,
      expected: `${attrs}\n\n${annotations}`,
    },
    {
      name: "empty content — unchanged",
      input: "",
      expected: "",
    },
    {
      name: "prose only — unchanged",
      input: "# Just prose\n\nNothing else here",
      expected: "# Just prose\n\nNothing else here",
    },
  ]

  it.each(cases)("$name", (c) => {
    expect(normalizeSingletonOrder(c.input)).toBe(c.expected)
  })

  it("is idempotent", () => {
    const input = `${annotations}\n\n# Title\n\n${attrs}\n\nProse`
    const once = normalizeSingletonOrder(input)
    const twice = normalizeSingletonOrder(once)
    expect(twice).toBe(once)
  })
})

describe("expandBlockIdRefs", () => {
  const annotationsBlock = (entries: { id: string; text: string }[]): string =>
    block("json-annotations", JSON.stringify({ annotations: entries }, null, "\t"))

  const calloutBlock = (content: string): string =>
    block(
      "json-callout",
      JSON.stringify(
        {
          id: "callout-1abc23d4",
          type: "codebook-code",
          title: "Test",
          content,
          color: "blue",
          collapsed: false,
        },
        null,
        "\t"
      )
    )

  const expandedCallout = (content: string): string =>
    block(
      "json-callout",
      JSON.stringify(
        {
          id: "callout-1abc23d4",
          type: "codebook-code",
          title: "Test",
          content,
          color: "blue",
          collapsed: false,
        },
        null,
        "\t"
      )
    )

  const cases = [
    {
      name: "replaces annotation ID with annotation text",
      input: [
        calloutBlock("See annotation-1abc23d4 for details"),
        annotationsBlock([{ id: "annotation-1abc23d4", text: "important finding" }]),
      ].join("\n\n"),
      expected: [
        expandedCallout("See important finding for details"),
        annotationsBlock([{ id: "annotation-1abc23d4", text: "important finding" }]),
      ].join("\n\n"),
    },
    {
      name: "replaces multiple annotation IDs",
      input: [
        calloutBlock("First: annotation-1abc23d4, second: annotation-9xyz56e7"),
        annotationsBlock([
          { id: "annotation-1abc23d4", text: "alpha" },
          { id: "annotation-9xyz56e7", text: "beta" },
        ]),
      ].join("\n\n"),
      expected: [
        expandedCallout("First: alpha, second: beta"),
        annotationsBlock([
          { id: "annotation-1abc23d4", text: "alpha" },
          { id: "annotation-9xyz56e7", text: "beta" },
        ]),
      ].join("\n\n"),
    },
    {
      name: "leaves unknown annotation ID as-is",
      input: [
        calloutBlock("See annotation-9unknown1 here"),
        annotationsBlock([{ id: "annotation-1abc23d4", text: "known" }]),
      ].join("\n\n"),
      expected: [
        calloutBlock("See annotation-9unknown1 here"),
        annotationsBlock([{ id: "annotation-1abc23d4", text: "known" }]),
      ].join("\n\n"),
    },
    {
      name: "no annotations block — IDs left as-is",
      input: calloutBlock("See annotation-1abc23d4"),
      expected: calloutBlock("See annotation-1abc23d4"),
    },
    {
      name: "non-callout block — unchanged",
      input: [
        block("json-attributes", '{"type":"research","subject":"annotation-1abc23d4"}'),
        annotationsBlock([{ id: "annotation-1abc23d4", text: "found" }]),
      ].join("\n\n"),
      expected: [
        block("json-attributes", '{"type":"research","subject":"annotation-1abc23d4"}'),
        annotationsBlock([{ id: "annotation-1abc23d4", text: "found" }]),
      ].join("\n\n"),
    },
    {
      name: "already-expanded content (no IDs) — unchanged",
      input: [
        calloutBlock("See important finding for details"),
        annotationsBlock([{ id: "annotation-1abc23d4", text: "important finding" }]),
      ].join("\n\n"),
      expected: [
        calloutBlock("See important finding for details"),
        annotationsBlock([{ id: "annotation-1abc23d4", text: "important finding" }]),
      ].join("\n\n"),
    },
    {
      name: "no blocks — unchanged",
      input: "# Just prose",
      expected: "# Just prose",
    },
  ]

  it.each(cases)("$name", (c) => {
    expect(expandBlockIdRefs(c.input)).toBe(c.expected)
  })

  it("is idempotent", () => {
    const input = [
      calloutBlock("See annotation-1abc23d4 for details"),
      annotationsBlock([{ id: "annotation-1abc23d4", text: "important finding" }]),
    ].join("\n\n")
    const once = expandBlockIdRefs(input)
    const twice = expandBlockIdRefs(once)
    expect(twice).toBe(once)
  })

  it("resolves cross-file IDs via resolveId fallback", () => {
    const input = calloutBlock("See annotation-1abc23d4 for details")
    const resolveId = (id: string) =>
      id === "annotation-1abc23d4" ? "important finding" : undefined
    expect(expandBlockIdRefs(input, resolveId)).toBe(
      expandedCallout("See important finding for details")
    )
  })

  it("prefers same-file lookup over resolveId", () => {
    const input = [
      calloutBlock("See annotation-1abc23d4 for details"),
      annotationsBlock([{ id: "annotation-1abc23d4", text: "local text" }]),
    ].join("\n\n")
    const resolveId = () => "remote text"
    const result = expandBlockIdRefs(input, resolveId)
    expect(result).toContain("local text")
    expect(result).not.toContain("remote text")
  })
})

describe("normalizeBlockKeyOrder", () => {
  const orderedAnnotation = JSON.stringify(
    {
      annotations: [
        { text: "the text", reason: "why", color: "amber", id: "annotation-1abc23d4", actor: "ai" },
      ],
    },
    null,
    "\t"
  )

  it("reorders record fields to schema declaration order", () => {
    const permuted = JSON.stringify(
      {
        annotations: [
          {
            color: "amber",
            reason: "why",
            text: "the text",
            actor: "ai",
            id: "annotation-1abc23d4",
          },
        ],
      },
      null,
      "\t"
    )
    expect(normalizeBlockKeyOrder(block("json-annotations", permuted))).toBe(
      block("json-annotations", orderedAnnotation)
    )
  })

  it("permutations of the same record converge to one key order", () => {
    const a = { text: "t", reason: "r", color: "amber", id: "annotation-1abc23d4", actor: "ai" }
    const b = { color: "amber", reason: "r", text: "t", actor: "ai", id: "annotation-1abc23d4" }
    const keysAfter = (item: object): string[] => {
      const input = block("json-annotations", JSON.stringify({ annotations: [item] }))
      const body = normalizeBlockKeyOrder(input).split("\n").slice(1, -1).join("\n")
      const parsed = JSON.parse(body) as { annotations: Record<string, unknown>[] }
      return Object.keys(parsed.annotations[0])
    }
    expect(keysAfter(a)).toEqual(keysAfter(b))
    expect(keysAfter(b)).toEqual(["text", "reason", "color", "id", "actor"])
  })

  it("leaves an already-ordered block's bytes untouched", () => {
    const compact = block(
      "json-annotations",
      '{"annotations":[{"text":"t","reason":"r","color":"amber"}]}'
    )
    expect(normalizeBlockKeyOrder(compact)).toBe(compact)
  })

  it("keeps unknown fields after declared ones", () => {
    const input = block(
      "json-annotations",
      '{"annotations":[{"mystery":1,"text":"t","reason":"r","color":"amber"}]}'
    )
    const result = normalizeBlockKeyOrder(input)
    const parsed = JSON.parse(result.split("\n").slice(1, -1).join("\n")) as {
      annotations: Record<string, unknown>[]
    }
    expect(Object.keys(parsed.annotations[0])).toEqual(["text", "reason", "color", "mystery"])
  })

  it("ignores block types without record ids", () => {
    const input = block("json-attributes", '{"subject":"AI","type":"research"}')
    expect(normalizeBlockKeyOrder(input)).toBe(input)
  })

  it("is idempotent", () => {
    const input = block(
      "json-annotations",
      '{"annotations":[{"color":"amber","text":"t","reason":"r"}]}'
    )
    const once = normalizeBlockKeyOrder(input)
    expect(normalizeBlockKeyOrder(once)).toBe(once)
  })
})
