import { describe, it, expect } from "vitest"
import {
  assignIds,
  buildEntryMessages,
  entrySize,
  renderEntry,
  resolveRef,
  type Entry,
  type EntryInput,
} from "./entry"
import type { Message } from "./messages"

const numbered = (item: string, file: string, sentences: string[]): EntryInput<string> => ({
  item,
  file,
  content: { numbered: sentences },
})

const nineSentences = Array.from({ length: 9 }, (_, i) => `Sentence ${i + 1}.`)

describe("resolveRef", () => {
  const entries = assignIds([
    numbered("one", "a.md", ["Only."]),
    { item: "two", file: "a.md", content: { plain: ["whole entry text"] } },
    numbered("three", "b.md", nineSentences),
    numbered("four", "b.md", ["Only."]),
  ])

  it("resolves 3.7 to entry 3's item and sentence index 6", () => {
    const resolved = resolveRef("3.7", entries)
    expect(resolved?.entry.item).toBe("three")
    expect(resolved?.sentenceIndex).toBe(6)
  })

  const nothing: { ref: string; reason: string }[] = [
    { ref: "3-7", reason: "dash instead of dot" },
    { ref: "3.0", reason: "sentence part below 1" },
    { ref: "0.1", reason: "entry part below 1" },
    { ref: "a.3", reason: "non-numeric entry part" },
    { ref: "3.7.1", reason: "three parts" },
    { ref: "5.2", reason: "no entry 5 in a call of four" },
    { ref: "3.10", reason: "sentence past entry 3's nine" },
    { ref: "2.1", reason: "plain content has no sentences" },
  ]

  it.each(nothing)("$ref resolves to nothing ($reason)", ({ ref }) => {
    expect(resolveRef(ref, entries)).toBeNull()
  })
})

describe("renderEntry", () => {
  it("matches the spec example exactly", () => {
    const entry: Entry<null> = {
      id: 3,
      item: null,
      file: "council-2019.md",
      children: [{ tag: "occurrence", attributes: { n: "1", ref: "3.2" }, body: "Mrs Devlin" }],
      content: {
        numbered: [
          "The chair opened the session at 9.15.",
          "Mrs Devlin objected to the timing.",
          "She asked for deferral until the impact study was circulated.",
        ],
      },
    }
    expect(renderEntry(entry)).toBe(
      `<entry id="3" file="council-2019.md">
<occurrence n="1" ref="3.2">Mrs Devlin</occurrence>
[3.1] The chair opened the session at 9.15.
[3.2] Mrs Devlin objected to the timing.
[3.3] She asked for deferral until the impact study was circulated.
</entry>`
    )
  })

  it("restarts numbering per entry, children before content, only id and file attributes", () => {
    const entries = assignIds([
      {
        item: "a",
        file: "a.md",
        children: [{ tag: "code", body: "K1" }],
        content: { numbered: ["A one.", "A two.", "A three."] },
      },
      {
        item: "b",
        file: "b.md",
        children: [{ tag: "code", body: "K2" }],
        content: { numbered: ["B one.", "B two.", "B three."] },
      },
    ])
    const [first, second] = entries.map((entry) => renderEntry(entry))
    expect(first).toBe(
      `<entry id="1" file="a.md">\n<code>K1</code>\n[1.1] A one.\n[1.2] A two.\n[1.3] A three.\n</entry>`
    )
    expect(second).toBe(
      `<entry id="2" file="b.md">\n<code>K2</code>\n[2.1] B one.\n[2.2] B two.\n[2.3] B three.\n</entry>`
    )
  })

  it("renders plain segments in order, defusing inside decorator bodies, without numbering", () => {
    const [entry] = assignIds([
      {
        item: null,
        file: "notes.md",
        content: {
          plain: [
            "the text before",
            { tag: "marked", body: "a candidate quoting <marked> literally" },
            "the text after",
          ],
        },
      },
    ])
    expect(renderEntry(entry)).toBe(
      `<entry id="1" file="notes.md">
the text before
<marked>a candidate quoting ‹marked> literally</marked>
the text after
</entry>`
    )
  })

  it("defuses a literal closing tag and escapes a quoted file path, keeping one entry", () => {
    const [entry] = assignIds([
      numbered("x", `he said "yes".md`, ["A line hiding </entry> inside.", "A tame line."]),
    ])
    const rendered = renderEntry(entry)
    expect(rendered).toContain(`file="he said &quot;yes&quot;.md"`)
    expect(rendered).toContain("[1.1] A line hiding ‹/entry> inside.")
    expect(rendered.match(/<\/entry>/g)).toHaveLength(1)
    expect(rendered.match(/<entry /g)).toHaveLength(1)
  })
})

describe("assignIds", () => {
  it("assigns ordinals 1..n in list order", () => {
    const entries = assignIds([
      numbered("a", "a.md", ["One."]),
      numbered("b", "a.md", ["One."]),
      numbered("c", "b.md", ["One."]),
    ])
    expect(entries.map((entry) => entry.id)).toEqual([1, 2, 3])
    expect(entries.map((entry) => entry.item)).toEqual(["a", "b", "c"])
  })
})

describe("entrySize", () => {
  it("is the character count of the rendered entry", () => {
    const input = numbered("a", "a.md", ["One.", "Two."])
    expect(entrySize(input)).toBe(renderEntry({ ...input, id: 1 }).length)
  })
})

describe("buildEntryMessages", () => {
  it("marks the last stable message, keeps volatile unmarked, one system message per entry, call-to-action last", () => {
    const stable: Message[] = [
      { type: "message", role: "system", content: "the rules" },
      { type: "message", role: "system", content: "the shared fragment" },
    ]
    const volatile: Message[] = [
      { type: "message", role: "system", content: "known values so far" },
    ]
    const entries = assignIds([
      numbered("a", "a.md", ["A one."]),
      numbered("b", "a.md", ["B one."]),
      numbered("c", "b.md", ["C one."]),
    ])

    const messages = buildEntryMessages(
      { stable, volatile, callToAction: "judge each entry" },
      entries
    )

    expect(messages).toHaveLength(7)
    expect(messages[0]).toEqual({ type: "message", role: "system", content: "the rules" })
    expect(messages[1].content).toEqual([
      {
        type: "input_text",
        text: "the shared fragment",
        prompt_cache_breakpoint: { mode: "explicit" },
      },
    ])
    expect(messages[2]).toEqual({
      type: "message",
      role: "system",
      content: "known values so far",
    })
    expect(messages.slice(3, 6)).toEqual(
      entries.map((entry) => ({ type: "message", role: "system", content: renderEntry(entry) }))
    )
    expect(messages[6]).toEqual({ type: "message", role: "user", content: "judge each entry" })
  })
})
