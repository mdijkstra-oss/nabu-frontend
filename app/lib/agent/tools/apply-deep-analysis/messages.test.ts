import { describe, it, expect } from "vitest"
import {
  partitionSources,
  buildCallList,
  buildFindCall,
  buildSourceMessages,
  type ContentResolver,
} from "./messages"
import { injectBoundaryComments } from "~/lib/patch/resolve/json-boundary"

const FRAMEWORK_PATH = "general_codebook.md"
const GOVERNANCE_PATH = "governance.md"

const frameworkContent = [
  "# General Codebook",
  "",
  "## Scope",
  "",
  "- Code only government speakers (ministers, officials). Treat",
  "\tjournalist questions as context unless the answer can't be",
  "\tunderstood without them.",
  "- When a passage is clearly off-topic from COVID governance,",
  "\tleave it uncoded.",
  "",
  "## Threshold",
  "",
  "- Prefer the narrower, defensible reading. When a passage doesn't",
  "\tclearly meet a code's inclusion criteria, leave it uncoded.",
  "",
  "```json-attributes",
  '{"type":"press conference transcript","subject":"public health","hash":"05f19b7460caf1ba"}',
  "```",
].join("\n")

const governanceCallouts = [
  {
    id: "callout-8icfq22d",
    type: "codebook-code",
    title: "Citizen-facing rules & thresholds",
    color: "blue",
    collapsed: false,
    content:
      "Citizen-facing behavioral rules, thresholds, or concrete parameter guidance communicated to the public.\n\nInclusion criteria:\n- Apply when the speaker specifies a concrete behavioral rule/threshold/parameter.\n- Include when framed as an appeal/request as long as the content is a concrete rule.\n\nExclusion criteria:\n- Exclude government-internal policy commitments.\n- Exclude enforcement/penalty thresholds.",
    actor: "user",
  },
  {
    id: "callout-2wnrt1n8",
    type: "codebook-code",
    title: "Responsibilization",
    color: "teal",
    collapsed: false,
    content:
      "Shifts responsibility for achieving a policy/collective outcome onto citizens' individual or collective behavior.\n\nInclusion criteria:\n- Apply when the speaker frames controlling COVID outcomes as dependent on citizens' compliance/behavior.\n\nExclusion criteria:\n- Exclude generic calls for unity/solidarity without an explicit responsibility shift.",
    actor: "user",
  },
  {
    id: "callout-2n6xupou",
    type: "codebook-code",
    title: "Privacy & data protection",
    color: "green",
    collapsed: false,
    content:
      "Privacy, data-protection, and data-minimization framing used to set constraints for digital governance tools.\n\nInclusion criteria:\n- Apply when the speaker sets privacy/data-protection conditions.\n\nExclusion criteria:\n- Exclude general IT/technical talk not tied to privacy.",
    actor: "user",
  },
  {
    id: "callout-9w3ynj4i",
    type: "codebook-code",
    title: "Monitoring, metrics & steering",
    color: "cyan",
    collapsed: false,
    content:
      "Use of monitoring systems, indicators, dashboards to justify government intervention.\n\nInclusion criteria:\n- Apply when the speaker references dashboards/indicators/measurement as providing insight needed for decisions.\n\nExclusion criteria:\n- Exclude pure capacity talk unless emphasis is on indicators.",
    actor: "user",
  },
]

const governanceContent = [
  "# Governance",
  "",
  "Codes for governance mechanisms and public-facing steering: concrete rules/thresholds, shifting responsibility onto citizens, privacy/data-protection constraints, and metric-driven monitoring and intervention logic.",
  ...governanceCallouts.flatMap((c) => ["```json-callout", JSON.stringify(c, null, "\t"), "```"]),
  "",
  "```json-attributes",
  JSON.stringify({
    tags: ["tag-5p9cz6tg"],
    type: "coding manual",
    subject: "governance",
    hash: "bd45df9bb3d152ad",
  }),
  "```",
].join("\n")

const targetContent = [
  "De minister-president kondigde vandaag nieuwe maatregelen aan.",
  "Burgers moeten anderhalve meter afstand houden.",
  "Restaurants blijven gesloten tot nader order.",
  "Het coronadashboard wordt verder uitgebreid.",
  "We vragen iedereen thuis te blijven bij klachten.",
].join("\n")

const buildResolver = (files: Record<string, string>): ContentResolver => {
  const map = new Map(Object.entries(files).map(([k, v]) => [k, injectBoundaryComments(v)]))
  return (path) => map.get(path)
}

const allCalloutIds = governanceCallouts.map((c) => c.id)

describe("buildFindCall with real governance content", () => {
  const resolve = buildResolver({
    [FRAMEWORK_PATH]: frameworkContent,
    [GOVERNANCE_PATH]: governanceContent,
  })

  const sources = { framework: [FRAMEWORK_PATH], dimension: [GOVERNANCE_PATH] }

  interface AnalysisTagCase {
    name: string
    id: string
    title: string
  }

  const analysisTagCases: AnalysisTagCase[] = governanceCallouts.map((c) => ({
    name: `callout "${c.title}" appears as <analysis> tag`,
    id: c.id,
    title: c.title,
  }))

  it.each(analysisTagCases)("$name", ({ id, title }) => {
    const { messages } = buildFindCall(targetContent, sources, resolve)
    const allContent = messages.map((m) => m.content).join("\n")
    expect(allContent).toContain(`<analysis id="${id}">`)
    expect(allContent).toContain(`# ${title}`)
  })

  it("all four governance callouts survive the pipeline", () => {
    const { messages } = buildFindCall(targetContent, sources, resolve)
    const allContent = messages.map((m) => m.content).join("\n")
    for (const id of allCalloutIds) {
      expect(allContent).toContain(`<analysis id="${id}">`)
    }
  })

  it("json-attributes block is stripped from governance source", () => {
    const { messages } = buildFindCall(targetContent, sources, resolve)
    const allContent = messages.map((m) => m.content).join("\n")
    expect(allContent).not.toContain("json-attributes")
    expect(allContent).not.toContain("bd45df9bb3d152ad")
  })

  it("json-attributes block is stripped from framework source", () => {
    const { messages } = buildFindCall(targetContent, sources, resolve)
    const allContent = messages.map((m) => m.content).join("\n")
    expect(allContent).not.toContain("05f19b7460caf1ba")
  })

  it("framework prose appears in messages", () => {
    const { messages } = buildFindCall(targetContent, sources, resolve)
    const frameworkMsg = messages.find(
      (m) => m.role === "system" && m.content.includes("General Codebook")
    )
    expect(frameworkMsg).toBeDefined()
    expect(frameworkMsg?.content).toContain("narrower, defensible reading")
  })

  it("target appears in <target file=... prefix=...> wrapper with numbered sentences", () => {
    const { messages } = buildFindCall(targetContent, sources, resolve)
    const targetMsg = messages.find(
      (m) => m.role === "system" && m.content.includes('<target file="target" prefix="a">')
    )
    expect(targetMsg).toBeDefined()
    expect(targetMsg?.content).toContain("anderhalve meter")
  })

  it("returns correct sentence count", () => {
    const { sentences } = buildFindCall(targetContent, sources, resolve)
    expect(sentences).toHaveLength(5)
  })

  it("returns prefixes with default firstFile", () => {
    const { prefixes } = buildFindCall(targetContent, sources, resolve)
    expect(prefixes).toHaveLength(1)
    expect(prefixes[0].file).toBe("target")
    expect(prefixes[0].prefix).toBe("a")
  })

  it("respects custom firstFile", () => {
    const { prefixes } = buildFindCall(targetContent, sources, resolve, "", "", "custom.md")
    expect(prefixes[0].file).toBe("custom.md")
  })
})

describe("buildFindCall with multi-file content", () => {
  const resolve = buildResolver({
    [FRAMEWORK_PATH]: frameworkContent,
    [GOVERNANCE_PATH]: governanceContent,
  })

  const sources = { framework: [FRAMEWORK_PATH], dimension: [GOVERNANCE_PATH] }

  const multiContent = [
    "First sentence in file A.",
    "Second sentence in file A.",
    "",
    "§§ other.md [10-20]",
    "",
    "First sentence in file B.",
    "Second sentence in file B.",
  ].join("\n")

  it("produces two target blocks for two files", () => {
    const { messages } = buildFindCall(multiContent, sources, resolve, "", "", "file-a.md")
    const allContent = messages.map((m) => m.content).join("\n")
    expect(allContent).toContain('<target file="file-a.md" prefix="a">')
    expect(allContent).toContain('<target file="other.md" prefix="b">')
  })

  it("returns correct sentence count across files", () => {
    const { sentences } = buildFindCall(multiContent, sources, resolve, "", "", "file-a.md")
    expect(sentences).toHaveLength(4)
  })

  it("returns correct prefixes for two files", () => {
    const { prefixes } = buildFindCall(multiContent, sources, resolve, "", "", "file-a.md")
    expect(prefixes).toHaveLength(2)
    expect(prefixes[0]).toEqual({ file: "file-a.md", prefix: "a", offset: 0, count: 2 })
    expect(prefixes[1]).toEqual({ file: "other.md", prefix: "b", offset: 2, count: 2 })
  })
})

describe("buildCallList fans dimensions", () => {
  it("one call per dimension, each with framework", () => {
    const scoped = partitionSources([
      { path: FRAMEWORK_PATH, scope: "framework" },
      { path: "dim-a.md", scope: "dimension" },
      { path: "dim-b.md", scope: "dimension" },
    ])

    const calls = buildCallList(scoped)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({ framework: [FRAMEWORK_PATH], dimension: ["dim-a.md"] })
    expect(calls[1]).toEqual({ framework: [FRAMEWORK_PATH], dimension: ["dim-b.md"] })
  })
})

describe("buildSourceMessages", () => {
  it("drops sources that resolve to empty after processing", () => {
    const emptyDimension = "```json-settings\n{}\n```"
    const resolve = buildResolver({
      [FRAMEWORK_PATH]: frameworkContent,
      empty: emptyDimension,
    })

    const messages = buildSourceMessages(
      { framework: [FRAMEWORK_PATH], dimension: ["empty"] },
      resolve
    )

    expect(messages).toHaveLength(1)
    expect(messages[0].content).toContain("General Codebook")
  })
})
