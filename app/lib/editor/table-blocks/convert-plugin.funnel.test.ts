import { describe, it, expect } from "vitest"
import { Schema, type Mark, type Node as ProseMirrorNode, type NodeType } from "prosemirror-model"
import { EditorState } from "prosemirror-state"
import { SerializerState, type JSONRecord } from "@milkdown/transformer"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkStringify from "remark-stringify"
import remarkGfm from "remark-gfm"
import { createTableConversionPlugin, readTableNode } from "./convert-plugin"
import { claimConverted } from "./conversion-meta"
import { parseTable, type TableBlock } from "~/domain/data-blocks/table/schema"
import { findBlocksByLanguage } from "~/lib/data-blocks/parse"
import { convertPipeTables } from "~/domain/data-blocks/migrations/convert-pipe-tables"

type NodeRunner = (state: SerializerState, node: ProseMirrorNode) => void

const nodeRunner = (name: string, runner: NodeRunner) => ({
  match: (node: ProseMirrorNode) => node.type.name === name,
  runner,
})

const markRunner = (name: string, props?: (mark: Mark) => JSONRecord) => ({
  match: (mark: Mark) => mark.type.name === name,
  runner: (state: SerializerState, mark: Mark) => {
    state.withMark(mark, name, undefined, props?.(mark))
  },
})

const container =
  (mdastType: string): NodeRunner =>
  (state, node) => {
    state.openNode(mdastType)
    state.next(node.content)
    state.closeNode()
  }

// Mirrors @milkdown/preset-gfm's table content expression (cells hold a
// paragraph, the header row its own node type) and the commonmark code_block the
// converter replaces a table with. @milkdown/transformer looks a toMarkdown spec
// up on every type in the schema, so each one carries its preset's runner.
const schema = new Schema({
  nodes: {
    doc: {
      content: "block+",
      toMarkdown: nodeRunner("doc", (state, node) => {
        state.openNode("root")
        state.next(node.content)
      }),
    },
    text: {
      toMarkdown: nodeRunner("text", (state, node) => {
        state.addNode("text", undefined, node.text)
      }),
    },
    paragraph: {
      content: "text*",
      group: "block",
      toMarkdown: nodeRunner("paragraph", container("paragraph")),
    },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      attrs: { language: { default: "" } },
      toMarkdown: nodeRunner("code_block", (state, node) => {
        state.addNode("code", undefined, node.textContent, { lang: node.attrs.language })
      }),
    },
    blockquote: {
      content: "block+",
      group: "block",
      toMarkdown: nodeRunner("blockquote", container("blockquote")),
    },
    bullet_list: {
      content: "list_item+",
      group: "block",
      toMarkdown: nodeRunner("bullet_list", (state, node) => {
        state.openNode("list", undefined, { ordered: false, spread: false })
        state.next(node.content)
        state.closeNode()
      }),
    },
    list_item: {
      content: "block+",
      toMarkdown: nodeRunner("list_item", (state, node) => {
        state.openNode("listItem", undefined, { spread: false })
        state.next(node.content)
        state.closeNode()
      }),
    },
    table: {
      content: "table_header_row table_row+",
      group: "block",
      toMarkdown: nodeRunner("table", container("table")),
    },
    table_header_row: {
      content: "table_header+",
      toMarkdown: nodeRunner("table_header_row", container("tableRow")),
    },
    table_row: {
      content: "table_cell+",
      toMarkdown: nodeRunner("table_row", container("tableRow")),
    },
    table_header: {
      content: "paragraph",
      toMarkdown: nodeRunner("table_header", container("tableCell")),
    },
    table_cell: {
      content: "paragraph",
      toMarkdown: nodeRunner("table_cell", container("tableCell")),
    },
  },
  marks: {
    strong: { toMarkdown: markRunner("strong") },
    emphasis: { toMarkdown: markRunner("emphasis") },
    link: {
      attrs: { href: { default: "" } },
      toMarkdown: markRunner("link", (mark) => ({ url: mark.attrs.href })),
    },
  },
})

const serialize = SerializerState.create(
  schema,
  unified().use(remarkParse).use(remarkGfm).use(remarkStringify)
)

type CellContent = readonly ProseMirrorNode[]

const plain = (text: string): CellContent => (text === "" ? [] : [schema.text(text)])

const strong = (text: string): CellContent => [schema.text(text, [schema.marks.strong.create()])]

const link = (text: string, href: string): CellContent => [
  schema.text(text, [schema.marks.link.create({ href })]),
]

const cell = (type: NodeType, content: CellContent): ProseMirrorNode =>
  type.create(null, schema.nodes.paragraph.create(null, content))

const tableNode = (rows: CellContent[][]): ProseMirrorNode => {
  const { table, table_header_row, table_row, table_header, table_cell } = schema.nodes
  const [header = [], ...body] = rows
  return table.create(null, [
    table_header_row.create(
      null,
      header.map((content) => cell(table_header, content))
    ),
    ...body.map((row) =>
      table_row.create(
        null,
        row.map((content) => cell(table_cell, content))
      )
    ),
  ])
}

const textTable = (rows: string[][]): ProseMirrorNode =>
  tableNode(rows.map((row) => row.map(plain)))

const para = (text: string): ProseMirrorNode => schema.node("paragraph", null, schema.text(text))

const quoted = (...content: ProseMirrorNode[]): ProseMirrorNode =>
  schema.node("blockquote", null, content)

const listed = (...content: ProseMirrorNode[]): ProseMirrorNode =>
  schema.node("bullet_list", null, [schema.node("list_item", null, content)])

const stateWithPlugin = (doc: ProseMirrorNode): EditorState =>
  EditorState.create({ doc, plugins: [createTableConversionPlugin(serialize)] })

const converted = (...content: ProseMirrorNode[]): ProseMirrorNode => {
  const state = stateWithPlugin(emptyDoc())
  return state.apply(state.tr.replaceWith(0, 2, content)).doc
}

const isConvertedBlock = (node: ProseMirrorNode): boolean =>
  node.type.name === "code_block" && node.attrs.language === "json-table"

const ancestorsOfConvertedBlock = (doc: ProseMirrorNode): string[] => {
  const ancestors: string[] = []
  doc.descendants((node, pos) => {
    if (!isConvertedBlock(node)) return true
    const $pos = doc.resolve(pos)
    for (let depth = 0; depth <= $pos.depth; depth++) ancestors.push($pos.node(depth).type.name)
    return false
  })
  return ancestors
}

const topLevelNodeTypes = (markdown: string): string[] =>
  unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown)
    .children.map((node) => node.type)

// The shape app/lib/files' structural check rejects — "Code fence ``` must be at
// the start of its own line" — a fence a blockquote marker, at any nesting depth,
// pushes off the start of its line. A file it rejects is never written at all.
const QUOTED_FENCE = /^[>\s]*>\s*```/m

const withoutIds = (markdown: string): string => markdown.replace(/"id": "[^"]*"/g, '"id": "ID"')

const reformatted = (markdown: string): string =>
  unified().use(remarkParse).use(remarkGfm).use(remarkStringify).processSync(markdown).toString()

const comparable = (markdown: string): string => withoutIds(reformatted(markdown))

const tableNodeCount = (doc: ProseMirrorNode): number => {
  let count = 0
  doc.descendants((node) => {
    if (node.type.name === "table") count++
    return true
  })
  return count
}

const convertedBlocks = (doc: ProseMirrorNode) => {
  const blocks: ReturnType<typeof parseTable>[] = []
  doc.descendants((node) => {
    if (node.type.name === "code_block" && node.attrs.language === "json-table") {
      blocks.push(parseTable(node.textContent))
    }
    return true
  })
  return blocks
}

const withoutId = (block: TableBlock | null | undefined) => {
  if (!block) return null
  const { id: _id, ...rest } = block
  return rest
}

const migrate = (markdown: string): TableBlock | null => {
  const [block] = findBlocksByLanguage(convertPipeTables.upgrade(markdown), "json-table")
  return block ? parseTable(block.content) : null
}

const sample = [
  ["Region", "Revenue"],
  ["North", "1200"],
]

const emptyDoc = () => schema.node("doc", null, [schema.node("paragraph")])

describe("readTableNode", () => {
  it("reads the header off the header row, not off the first body row", () => {
    const node = textTable([
      ["Region", "Revenue"],
      ["North", "1200"],
      ["South", "950"],
    ])
    expect(readTableNode(node, serialize)).toEqual({
      header: ["Region", "Revenue"],
      rows: [
        ["North", "1200"],
        ["South", "950"],
      ],
    })
  })

  // conversion.md:21 — "inline markdown (`**bold**`, links) is kept as its
  // literal source characters ... no characters are lost".
  it("keeps a cell's emphasis markers and link target", () => {
    const node = tableNode([
      [plain("Name"), plain("Link")],
      [strong("bold"), link("site", "https://x")],
    ])
    expect(readTableNode(node, serialize).rows).toEqual([["**bold**", "[site](https://x)"]])
  })
})

// conversion.md:38 — "a table node may exist transiently inside a transaction, but
// never survives into committed editor state". Nothing else in the repo exercises
// appendTransaction; disabling it leaves every other suite green.
describe("the table-node funnel", () => {
  it("replaces a table node that enters the document with a json-table block", () => {
    const state = stateWithPlugin(emptyDoc())

    const next = state.apply(state.tr.replaceWith(0, 2, textTable(sample)))

    expect(tableNodeCount(next.doc)).toBe(0)
    expect(convertedBlocks(next.doc)).toEqual([
      expect.objectContaining({
        columns: [
          { key: "region", name: "Region", type: "text" },
          { key: "revenue", name: "Revenue", type: "number" },
        ],
        rows: [{ region: "North", revenue: "1200" }],
      }),
    ])
  })

  it("converts every table of a multi-table paste in one pass, each with its own id", () => {
    const state = stateWithPlugin(emptyDoc())

    const next = state.apply(
      state.tr.replaceWith(0, 2, [textTable(sample), schema.node("paragraph"), textTable(sample)])
    )

    expect(tableNodeCount(next.doc)).toBe(0)
    const ids = convertedBlocks(next.doc).map((block) => block?.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  // conversion.md:37 — "both live triggers mark the new block id in
  // conversion-meta.ts, and the grid's node view claims it once on mount".
  it("marks each converted block id for the node view to claim once", () => {
    const state = stateWithPlugin(emptyDoc())

    const next = state.apply(state.tr.replaceWith(0, 2, textTable(sample)))
    const id = convertedBlocks(next.doc)[0]?.id ?? ""

    expect(claimConverted(id)).toBe(true)
    expect(claimConverted(id)).toBe(false)
  })

  it("leaves a document with no table node alone", () => {
    const state = stateWithPlugin(
      schema.node("doc", null, [schema.node("paragraph", null, schema.text("plain"))])
    )

    const next = state.apply(state.tr.insertText("!", 6))

    expect(next.doc.toString()).toBe(
      schema.node("doc", null, [schema.node("paragraph", null, schema.text("plain!"))]).toString()
    )
  })
})

// `> ` is not JSON whitespace (RFC 8259 §2) and `parseCodeBlocks` does not strip
// it, so a fence left inside the quote serializes as `> ```json-table` — which
// app/lib/files rejects, refusing to write the file at all. The paste is then
// lost. The block is lifted clear of every enclosing quote, splitting it.
describe("a converted table a blockquote encloses", () => {
  const cases: {
    name: string
    content: ProseMirrorNode[]
    topLevelNodes: string[]
  }[] = [
    {
      name: "the quote holds nothing else",
      content: [textTable(sample)],
      topLevelNodes: ["code"],
    },
    {
      name: "the table opens the quote",
      content: [textTable(sample), para("Counted Tuesday.")],
      topLevelNodes: ["code", "blockquote"],
    },
    {
      name: "the table closes the quote",
      content: [para("Stock:"), textTable(sample)],
      topLevelNodes: ["blockquote", "code"],
    },
    {
      name: "quoted prose sits on both sides",
      content: [para("Stock:"), textTable(sample), para("Counted Tuesday.")],
      topLevelNodes: ["blockquote", "code", "blockquote"],
    },
    {
      name: "a list item inside the quote holds the table",
      content: [listed(para("Items:"), textTable(sample)), para("Counted Tuesday.")],
      topLevelNodes: ["blockquote", "code", "blockquote"],
    },
    {
      name: "a nested quote holds the table",
      content: [para("Outer."), quoted(para("Inner."), textTable(sample))],
      topLevelNodes: ["blockquote", "code"],
    },
  ]

  it.each(cases)("lifts the block to the top level — $name", ({ content }) => {
    expect(ancestorsOfConvertedBlock(converted(quoted(...content)))).toEqual(["doc"])
  })

  it.each(cases)("serializes no fence behind a quote marker — $name", ({ content }) => {
    expect(serialize(converted(quoted(...content)))).not.toMatch(QUOTED_FENCE)
  })

  it.each(cases)("leaves the quoted prose quoted — $name", ({ content, topLevelNodes }) => {
    expect(topLevelNodeTypes(serialize(converted(quoted(...content))))).toEqual(topLevelNodes)
  })
})

describe("a converted table no blockquote encloses", () => {
  const cases: {
    name: string
    content: ProseMirrorNode[]
    ancestors: string[]
    topLevelNodes: string[]
  }[] = [
    {
      name: "prose surrounds it at the top level",
      content: [para("Intro."), textTable(sample), para("Tail.")],
      ancestors: ["doc"],
      topLevelNodes: ["paragraph", "code", "paragraph"],
    },
    {
      name: "a list item holds it",
      content: [listed(para("Items:"), textTable(sample))],
      ancestors: ["doc", "bullet_list", "list_item"],
      topLevelNodes: ["list"],
    },
  ]

  it.each(cases)("is replaced where it stood — $name", ({ content, ancestors, topLevelNodes }) => {
    const doc = converted(...content)

    expect(ancestorsOfConvertedBlock(doc)).toEqual(ancestors)
    expect(topLevelNodeTypes(serialize(doc))).toEqual(topLevelNodes)
  })
})

// conversion.md:3 — "Both paths are thin shells around one shared transform, so
// headers, keys, types, and captions come out identical no matter which door a
// table walked in through."
describe("the two doors", () => {
  const source = [
    "| Name | Link | Amount |",
    "| --- | --- | --- |",
    "| **bold** | [site](https://x) | 1200 |",
    "| a \\| b | plain | 950 |",
  ].join("\n")

  const node = tableNode([
    [plain("Name"), plain("Link"), plain("Amount")],
    [strong("bold"), link("site", "https://x"), plain("1200")],
    [plain("a | b"), plain("plain"), plain("950")],
  ])

  it("produce the same block for the same table", () => {
    const state = stateWithPlugin(emptyDoc())

    const next = state.apply(state.tr.replaceWith(0, 2, node))

    expect(withoutId(convertedBlocks(next.doc)[0])).toEqual(withoutId(migrate(source)))
  })

  const quotedSource = [
    "> Stock:",
    ">",
    "> | Region | Revenue |",
    "> | --- | --- |",
    "> | North | 1200 |",
    ">",
    "> Counted Tuesday.",
    "",
  ].join("\n")

  const quotedDoc = quoted(para("Stock:"), textTable(sample), para("Counted Tuesday."))

  it("produce the same document for a table inside a blockquote", () => {
    expect(comparable(serialize(converted(quotedDoc)))).toEqual(
      comparable(convertPipeTables.upgrade(quotedSource))
    )
  })
})
