import { describe, it, expect } from "vitest"
import { EditorState, type Plugin } from "prosemirror-state"
import { Decoration, DecorationSet, type Decoration as Deco } from "prosemirror-view"
import { createDoc } from "./fixtures"
import { createRegionsPlugin, regionsMeta } from "./plugin"
import type { RegionsMessage, RenderableRegion } from "./types"
import type { WidgetViewFactory } from "./decorations"

const widgetViewFactory: WidgetViewFactory = () => (pos, spec) =>
  Decoration.widget(pos, () => document.createElement("span"), spec)

interface DecorationInternals {
  type: { attrs?: Record<string, string> }
}

const attrsOf = (d: Deco): Record<string, string> =>
  (d as unknown as DecorationInternals).type.attrs ?? {}

const tintedIndexes = (plugin: Plugin, state: EditorState): string[] => {
  const set = plugin.props.decorations?.call(plugin, state) as DecorationSet | undefined
  return (set ?? DecorationSet.empty)
    .find()
    .map((d) => attrsOf(d)["data-region-tint"])
    .filter((index): index is string => index !== undefined)
}

const SENTENCES = ["Rutte: yeah, it was quite the event.", "This is great, said Rutte."]

const region = (index: number, quote: string, sentence: number): RenderableRegion => ({
  index,
  kind: "speaker",
  kindOrder: 0,
  label: "rutte",
  colour: "indigo",
  icon: "mic",
  quote,
  hitSentence: sentence,
  startSentence: sentence,
  endSentence: sentence,
})

const BOTH = [region(0, "Rutte", 0), region(1, "said Rutte", 1)]

const regionsMessage = (regions: RenderableRegion[]): RegionsMessage => ({
  type: "regions",
  regions,
  sentences: SENTENCES,
})

const send = (plugin: Plugin, state: EditorState, ...messages: RegionsMessage[]): EditorState =>
  messages.reduce((s, message) => s.apply(s.tr.setMeta(regionsMeta, message)), state)

describe("createRegionsPlugin", () => {
  const start = (): { plugin: Plugin; state: EditorState } => {
    const plugin = createRegionsPlugin(widgetViewFactory)
    const doc = createDoc(["Rutte: yeah, it was quite the event.", "This is great, said Rutte."])
    return { plugin, state: EditorState.create({ doc, plugins: [plugin] }) }
  }

  const cases: {
    name: string
    messages: RegionsMessage[]
    expected: string[]
  }[] = [
    { name: "nothing is tinted before a hover", messages: [regionsMessage(BOTH)], expected: [] },
    {
      name: "a hover tints exactly the hovered region",
      messages: [regionsMessage(BOTH), { type: "hover", index: 1 }],
      expected: ["1"],
    },
    {
      name: "a hover on no region clears the tint",
      messages: [regionsMessage(BOTH), { type: "hover", index: 1 }, { type: "hover", index: null }],
      expected: [],
    },
    {
      name: "the hover survives a payload that still holds the hovered region",
      messages: [regionsMessage(BOTH), { type: "hover", index: 1 }, regionsMessage(BOTH)],
      expected: ["1"],
    },
    {
      name: "the hover is dropped when the hovered region is no longer present",
      messages: [
        regionsMessage(BOTH),
        { type: "hover", index: 1 },
        regionsMessage([region(0, "Rutte", 0)]),
      ],
      expected: [],
    },
    {
      name: "an emptied payload drops the hover with the regions",
      messages: [regionsMessage(BOTH), { type: "hover", index: 1 }, regionsMessage([])],
      expected: [],
    },
    {
      name: "a region that comes back is not tinted by the hover it was dropped from",
      messages: [
        regionsMessage(BOTH),
        { type: "hover", index: 1 },
        regionsMessage([region(0, "Rutte", 0)]),
        regionsMessage(BOTH),
      ],
      expected: [],
    },
  ]

  it.each(cases)("$name", ({ messages, expected }) => {
    const { plugin, state } = start()
    expect(tintedIndexes(plugin, send(plugin, state, ...messages))).toEqual(expected)
  })

  it("a hover message leaves the document untouched", () => {
    const { plugin, state } = start()
    const before = send(plugin, state, regionsMessage(BOTH))
    const after = send(plugin, before, { type: "hover", index: 0 })
    expect(after.doc.eq(before.doc)).toBe(true)
  })
})
