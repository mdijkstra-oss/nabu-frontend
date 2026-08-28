import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { getCallouts } from "~/domain/data-blocks/callout/selectors"
import { stripBlocksByLanguage } from "~/lib/data-blocks/parse"
import { compareCodingMarkdown, parseCodingEvalArgs } from "./coding-eval"

const root = resolve("evals/coding/ptc")
const read = (path: string): string => readFileSync(resolve(root, path), "utf8")

describe("PTC coding fixture", () => {
  it("has a callout-free framework and one uniquely identified callout per dimension file", () => {
    expect(getCallouts(read("framework.md"))).toEqual([])
    const paths = readdirSync(resolve(root, "codes"))
      .filter((path) => path.endsWith(".md"))
      .sort()
    expect(paths).toHaveLength(14)
    const ids = paths.map((path) => {
      const callouts = getCallouts(read(`codes/${path}`))
      expect(callouts).toHaveLength(1)
      expect(path).toBe(`${callouts[0].id}.md`)
      return callouts[0].id
    })
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("derives the input by removing only the gold annotation block", () => {
    expect(read("article739140767.input.md").trimEnd()).toBe(
      stripBlocksByLanguage(read("article739140767.gold.md"), "json-annotations").trimEnd()
    )
  })
})

const argv = (passthrough: string, coders: string, adjudicate: string): string[] => [
  "--input",
  "input.md",
  "--framework",
  "framework.md",
  "--dimensions",
  "codes",
  "--output",
  "actual.md",
  "--passthrough",
  passthrough,
  "--coders",
  coders,
  "--adjudicate",
  adjudicate,
]

describe("coding eval CLI", () => {
  it("parses the documented one-coder configuration", () => {
    expect(
      parseCodingEvalArgs(argv("retrieval,semantic-filter", "voter-one", "false")).config
    ).toEqual({
      passthrough: new Set(["retrieval", "semantic-filter"]),
      coders: ["voter-one"],
      adjudicate: false,
    })
  })

  it("reads an empty passthrough list as the shipped configuration", () => {
    expect(parseCodingEvalArgs(argv("", "voter-one,voter-two", "true")).config).toEqual({
      passthrough: new Set(),
      coders: ["voter-one", "voter-two"],
      adjudicate: true,
    })
  })

  it("reports same-code source overlap while ignoring volatile annotation fields", () => {
    const gold = read("article739140767.gold.md")
    const actual =
      read("article739140767.input.md").trimEnd() +
      `\n\n\`\`\`json-annotations\n${JSON.stringify({
        annotations: [
          {
            id: "different",
            actor: "ai",
            text: "notorious for extreme violence and bloodshed.",
            reason: "different prose",
            code: "callout-2udgvv9z",
            vote: { find: { found: 1, missed: 0 } },
          },
        ],
      })}\n\`\`\``
    expect(compareCodingMarkdown(actual, gold)).toEqual({ actual: 1, gold: 1, overlapping: 1 })
  })

  it("rejects an empty generated annotation block", () => {
    const empty = `${read("article739140767.input.md")}\n\n\`\`\`json-annotations\n{"annotations":[]}\n\`\`\``
    expect(() => compareCodingMarkdown(empty, read("article739140767.gold.md"))).toThrow(
      "valid but empty"
    )
  })
})
