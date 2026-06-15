import { describe, test, expect } from "vitest"
import { unwrapBacktickEntities } from "./unwrap-backtick-entities"

describe("unwrapBacktickEntities", () => {
  const cases: [string, string, string][] = [
    ["tag in backticks", "see `#interview` here", "see #interview here"],
    ["multi-word tag slug", "see `#round-1` here", "see #round-1 here"],
    ["callout id in backticks", "ref `callout-1bc23456` now", "ref callout-1bc23456 now"],
    ["annotation id in backticks", "see `annotation-1a2b3c4d` ok", "see annotation-1a2b3c4d ok"],
    ["chart id in backticks", "see `chart-1aaa1111`", "see chart-1aaa1111"],
    ["search id in backticks", "see `search-2bbb2222`", "see search-2bbb2222"],
    ["tag id in backticks", "see `tag-3ccc3333`", "see tag-3ccc3333"],
    ["file in backticks", "open `notes.md` please", "open notes.md please"],
    ["file with underscores", "open `codebook_general.md` now", "open codebook_general.md now"],
    [
      "markdown link in backticks",
      "see `[hi](file://callout-1bc23456)`",
      "see [hi](file://callout-1bc23456)",
    ],
    ["leaves real code alone", "use `const x = 1` here", "use `const x = 1` here"],
    ["leaves prose in backticks", "the `important` thing", "the `important` thing"],
    [
      "leaves prose with hash mid-string",
      "the `look at #interview` thing",
      "the `look at #interview` thing",
    ],
    ["leaves fenced code", "```\n#interview\n```", "```\n#interview\n```"],
    ["leaves markdown link untouched", "[#interview](http://x.com)", "[#interview](http://x.com)"],
    ["multiple entities", "`#interview` and `callout-1bc23456`", "#interview and callout-1bc23456"],
    [
      "mixed with prose backticks",
      "`#interview` then `regular code` then `notes.md`",
      "#interview then `regular code` then notes.md",
    ],
    ["empty string", "", ""],
    ["no backticks", "plain text only", "plain text only"],
    ["trims whitespace inside", "see ` #interview ` here", "see #interview here"],
    ["capitalized callout prefix", "see `Callout-7xk2m9p1` here", "see Callout-7xk2m9p1 here"],
    ["uppercase callout prefix", "see `CALLOUT-7xk2m9p1` here", "see CALLOUT-7xk2m9p1 here"],
    ["leaves invalid-id-length", "see `callout-abc123` here", "see `callout-abc123` here"],
    ["leaves unknown prefix", "see `unknown-abc12345` here", "see `unknown-abc12345` here"],
  ]

  test.each(cases)("%s", (_, input, expected) => {
    expect(unwrapBacktickEntities(input)).toBe(expected)
  })
})
