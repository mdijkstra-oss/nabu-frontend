import { describe, test, expect } from "vitest"
import { normalizeEntityIdSeparators } from "./normalize-entity-id-separators"

describe("normalizeEntityIdSeparators", () => {
  const cases: [string, string, string][] = [
    ["callout underscore to hyphen", "ref callout_79zk5cps now", "ref callout-79zk5cps now"],
    [
      "multiple callouts",
      "see callout_79zk5cps and callout_8xge3yvg",
      "see callout-79zk5cps and callout-8xge3yvg",
    ],
    ["annotation underscore", "see annotation_1a2b3c4d here", "see annotation-1a2b3c4d here"],
    ["chart underscore", "see chart_1aaa1111", "see chart-1aaa1111"],
    ["search underscore", "see search_2bbb2222", "see search-2bbb2222"],
    ["tag underscore", "see tag_3ccc3333", "see tag-3ccc3333"],
    ["already hyphenated unchanged", "see callout-79zk5cps", "see callout-79zk5cps"],
    ["wrapped in parens", "(callout_79zk5cps)", "(callout-79zk5cps)"],
    ["wrapped in backticks", "`callout_79zk5cps`", "`callout-79zk5cps`"],
    ["wrapped in markdown emphasis", "**callout_79zk5cps**", "**callout-79zk5cps**"],
    [
      "leaves glued compound untouched",
      "see prefix_callout_79zk5cps",
      "see prefix_callout_79zk5cps",
    ],
    ["leaves trailing extension", "see callout_79zk5cps_extra", "see callout_79zk5cps_extra"],
    ["leaves wrong hex length", "see callout_abc123 here", "see callout_abc123 here"],
    ["leaves unknown prefix", "see unknown_abc12345 here", "see unknown_abc12345 here"],
    ["capitalized prefix", "see Callout_79zk5cps", "see Callout-79zk5cps"],
    ["uppercase prefix", "see CALLOUT_79zk5cps", "see CALLOUT-79zk5cps"],
    ["empty string", "", ""],
    ["no underscores", "plain text only", "plain text only"],
    [
      "mixed entities",
      "callout_79zk5cps then annotation_1a2b3c4d",
      "callout-79zk5cps then annotation-1a2b3c4d",
    ],
    ["preserves file underscore", "see notes_archive.md here", "see notes_archive.md here"],
  ]

  test.each(cases)("%s", (_, input, expected) => {
    expect(normalizeEntityIdSeparators(input)).toBe(expected)
  })
})
