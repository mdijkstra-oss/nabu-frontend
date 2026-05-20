import { describe, expect, it } from "vitest"
import { block } from "./test-helpers"
import { normalizeSingletonOrder, normalizeBlockFields } from "./normalize"

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
