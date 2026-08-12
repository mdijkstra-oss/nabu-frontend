import { describe, it, expect } from "vitest"
import { Schema, type Node } from "prosemirror-model"
import { EditorState } from "prosemirror-state"
import type { Plugin } from "prosemirror-state"
import { DecorationSet, type Decoration } from "prosemirror-view"
import { createSpotlightPlugin, spotlightMeta } from "./plugin"
import type { Spotlight } from "./types"

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    code_block: {
      group: "block",
      content: "text*",
      code: true,
      attrs: { language: { default: null } },
    },
    text: { group: "inline" },
  },
})

type BlockDef = string | { code: string; language?: string }

const isCodeDef = (def: BlockDef): def is { code: string; language?: string } =>
  typeof def !== "string"

const toNode = (def: BlockDef) =>
  isCodeDef(def)
    ? schema.nodes.code_block.create(
        { language: def.language ?? null },
        def.code ? schema.text(def.code) : null
      )
    : schema.nodes.paragraph.create(null, def ? schema.text(def) : null)

const createDoc = (blocks: BlockDef[]): Node => schema.nodes.doc.create(null, blocks.map(toNode))

interface DecorationInternals {
  type: { attrs?: Record<string, string> }
}

const attrsOf = (d: Decoration): Record<string, string> =>
  (d as unknown as DecorationInternals).type.attrs ?? {}

const decorationsOf = (plugin: Plugin, state: EditorState): Decoration[] => {
  const set = plugin.props.decorations?.call(plugin, state) as DecorationSet | undefined
  return (set ?? DecorationSet.empty).find()
}

interface Rendered {
  covers: string
  attrs: Record<string, string>
  spec: Record<string, unknown>
}

const render = (blocks: BlockDef[], spotlights: Spotlight[]): Rendered[] => {
  const plugin = createSpotlightPlugin()
  const doc = createDoc(blocks)
  const state = EditorState.create({ doc, plugins: [plugin] })
  const next = state.apply(state.tr.setMeta(spotlightMeta, spotlights))
  return decorationsOf(plugin, next).map((d) => ({
    covers: next.doc.textBetween(d.from, d.to, "\n"),
    attrs: attrsOf(d),
    spec: d.spec as Record<string, unknown>,
  }))
}

const single = (text: string): Spotlight => ({ type: "single", text })

describe("createSpotlightPlugin", () => {
  const cases: {
    name: string
    blocks: BlockDef[]
    spotlights: Spotlight[]
    expected: Rendered[]
  }[] = [
    {
      name: "single spotlight over text the document holds",
      blocks: ["The quick brown fox jumps over the lazy dog."],
      spotlights: [single("brown fox")],
      expected: [{ covers: "brown fox", attrs: { "data-spotlight": "true" }, spec: {} }],
    },
    {
      name: "single spotlight over text the document does not hold",
      blocks: ["The quick brown fox jumps over the lazy dog."],
      spotlights: [single("purple elephant")],
      expected: [],
    },
    {
      name: "range anchors its end on the first match after its start",
      blocks: ["Alpha end here. Then start here and more words. Finally end here again."],
      spotlights: [{ type: "range", from: "start here", to: "end here" }],
      expected: [
        {
          covers: "start here and more words. Finally end here",
          attrs: { "data-spotlight": "true" },
          spec: {},
        },
      ],
    },
    {
      name: "range inside a callout block decorates the callout and the range",
      blocks: ["Before the block.", { code: "Callout body text here.", language: "json-callout" }],
      spotlights: [single("body text")],
      expected: [
        { covers: "Callout body text here.", attrs: { "data-spotlight": "true" }, spec: {} },
        { covers: "body text", attrs: {}, spec: { spotlight: true } },
      ],
    },
    {
      name: "range leaving the callout takes the plain inline form",
      blocks: [
        { code: "Inside callout text.", language: "json-callout" },
        "Outside paragraph text.",
      ],
      spotlights: [{ type: "range", from: "Inside callout", to: "paragraph text" }],
      expected: [
        {
          covers: "Inside callout text.\nOutside paragraph text.",
          attrs: { "data-spotlight": "true" },
          spec: {},
        },
      ],
    },
  ]

  it.each(cases)("$name", ({ blocks, spotlights, expected }) => {
    const rendered = render(blocks, spotlights)
    expect(rendered).toHaveLength(expected.length)
    rendered.forEach((actual, i) => {
      expect(actual.covers).toBe(expected[i].covers)
      expect(actual.attrs).toMatchObject(expected[i].attrs)
      expect(actual.spec).toMatchObject(expected[i].spec)
    })
  })

  it("styles the plain inline form with an underline", () => {
    const [rendered] = render(["The quick brown fox."], [single("brown fox")])
    expect(rendered.attrs.style).toContain("border-bottom")
  })

  it("recomputes against the new document when it changes with no new meta", () => {
    const plugin = createSpotlightPlugin()
    const doc = createDoc(["The lazy dog."])
    const state = EditorState.create({ doc, plugins: [plugin] })
    const withMeta = state.apply(state.tr.setMeta(spotlightMeta, [single("brown fox")]))
    expect(decorationsOf(plugin, withMeta)).toHaveLength(0)

    const edited = withMeta.apply(withMeta.tr.insertText("The quick brown fox. ", 1))
    const decorations = decorationsOf(plugin, edited)
    expect(decorations).toHaveLength(1)
    expect(edited.doc.textBetween(decorations[0].from, decorations[0].to)).toBe("brown fox.")
  })
})
