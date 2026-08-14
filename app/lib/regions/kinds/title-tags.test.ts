import { describe, it, expect } from "vitest"
import { kindTitle, splitKindTags, stripKindTags } from "./title-tags"

describe("splitKindTags", () => {
  it.each([
    {
      name: "known kind tag becomes a kind part",
      title: ":speaker: rutte",
      parts: [{ type: "kind" }, { type: "text", text: " rutte" }],
    },
    {
      name: "unknown tag stays literal text",
      title: ":nope: rutte",
      parts: [{ type: "text", text: ":nope: rutte" }],
    },
    {
      name: "plain title is one text part",
      title: "rutte",
      parts: [{ type: "text", text: "rutte" }],
    },
    {
      name: "tag mid-title splits around it",
      title: "who is :date: friday",
      parts: [
        { type: "text", text: "who is " },
        { type: "kind" },
        { type: "text", text: " friday" },
      ],
    },
  ])("$name", ({ title, parts }) => {
    expect(splitKindTags(title)).toMatchObject(parts)
  })

  it("resolves the tag to the registry descriptor", () => {
    const [part] = splitKindTags(":speaker: x")
    expect(part).toMatchObject({ type: "kind", kind: { id: "speaker", icon: "mic" } })
  })
})

describe("stripKindTags", () => {
  it.each([
    { title: ":speaker: rutte", stripped: "rutte" },
    { title: "who is :date: friday", stripped: "who is friday" },
    { title: "plain title", stripped: "plain title" },
    { title: ":nope: kept", stripped: ":nope: kept" },
  ])("$title → $stripped", ({ title, stripped }) => {
    expect(stripKindTags(title)).toBe(stripped)
  })
})

describe("kindTitle", () => {
  it("round-trips through strip", () => {
    expect(stripKindTags(kindTitle("speaker", "rutte"))).toBe("rutte")
  })
})
