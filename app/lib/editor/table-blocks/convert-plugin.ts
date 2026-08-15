import { Plugin } from "prosemirror-state"
import { liftTarget } from "prosemirror-transform"
import type { Node as ProseMirrorNode, ResolvedPos, Schema } from "prosemirror-model"
import type { EditorState, Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { formatBlockJson } from "~/lib/data-blocks/parse"
import { pipeTableToBlock, type PipeTable } from "~/domain/data-blocks/table/from-pipe-table"
import type { TableBlock } from "~/domain/data-blocks/table/schema"
import { markConverted } from "./conversion-meta"

export interface EnterLine {
  nodeType: string
  text: string
}

export type SerializeMarkdown = (node: ProseMirrorNode) => string

export const splitRowCells = (text: string): string[] => {
  const trimmed = text.trim()
  if (trimmed.length < 2 || !trimmed.startsWith("|") || !trimmed.endsWith("|")) return []
  return trimmed
    .slice(1, -1)
    .split(UNESCAPED_PIPE)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"))
}

export const shouldConvertOnEnter = ({ nodeType, text }: EnterLine): boolean =>
  nodeType === "paragraph" && splitRowCells(text).length > 0

export const rowLineToBlock = (text: string): TableBlock =>
  pipeTableToBlock({ header: splitRowCells(text), rows: [[]] })

export const readTableNode = (table: ProseMirrorNode, serialize: SerializeMarkdown): PipeTable => {
  const rows: string[][] = []
  table.descendants((node) => {
    if (!ROW_TYPES.has(node.type.name)) return true
    rows.push(rowCells(node, serialize))
    return false
  })
  const [header = [], ...body] = rows
  return { header, rows: body }
}

export const createTableConversionPlugin = (serialize: SerializeMarkdown): Plugin =>
  new Plugin({
    appendTransaction: (_transactions, _oldState, newState) => {
      const tr = newState.tr
      return replaceTableNodes(newState, tr, serialize) ? tr : null
    },
    props: {
      handleKeyDown: (view, event) => isEnter(event) && convertRowLine(view),
    },
  })

const UNESCAPED_PIPE = /(?<!\\)\|/

const isEnter = (event: KeyboardEvent): boolean => event.key === "Enter" && !event.shiftKey

const convertRowLine = (view: EditorView): boolean => {
  const { $from, empty } = view.state.selection
  if (!empty) return false
  if (!shouldConvertOnEnter({ nodeType: $from.parent.type.name, text: $from.parent.textContent })) {
    return false
  }

  const block = rowLineToBlock($from.parent.textContent)
  markConverted(block.id)
  view.dispatch(
    view.state.tr.replaceWith($from.before(), $from.after(), blockNode(view.state.schema, block))
  )
  return true
}

// milkdown's gfm schema gives the header row its own node type — `table >
// table_header_row table_row+` (@milkdown/preset-gfm) — so matching only
// `table_row` silently promotes the first body row to the header.
const ROW_TYPES = new Set(["table_header_row", "table_row"])

// @milkdown/transformer's serializer walks a whole document: handed the cell
// node itself it emits a gfm `tableCell` and leaves its stack unbalanced. The
// cell's inline content re-homed under a doc comes back as the cell's own
// markdown source, marks and link targets intact, one paragraph's newline long.
const cellSource = (cell: ProseMirrorNode, serialize: SerializeMarkdown): string =>
  serialize(cell.type.schema.nodes.doc.create(null, cell.content)).trim()

const rowCells = (row: ProseMirrorNode, serialize: SerializeMarkdown): string[] => {
  const cells: string[] = []
  row.forEach((cell) => cells.push(cellSource(cell, serialize)))
  return cells
}

const blockNode = (schema: Schema, block: TableBlock): ProseMirrorNode =>
  schema.nodes.code_block.create({ language: "json-table" }, [schema.text(formatBlockJson(block))])

interface FoundTable {
  pos: number
  node: ProseMirrorNode
}

const findTableNodes = (doc: ProseMirrorNode): FoundTable[] => {
  const found: FoundTable[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true
    found.push({ pos, node })
    return false
  })
  return found
}

// Table nodes reach the document from the gfm preset's input rules and insert
// commands, from the clipboard plugin's markdown parse, and from pasted HTML
// (how a spreadsheet copy arrives) — every one of them through a transaction.
const replaceTableNodes = (
  state: EditorState,
  tr: Transaction,
  serialize: SerializeMarkdown
): boolean => {
  const tables = findTableNodes(state.doc)
  if (tables.length === 0) return false

  for (const { pos, node } of tables.reverse()) {
    const block = pipeTableToBlock(readTableNode(node, serialize))
    markConverted(block.id)
    tr.replaceWith(pos, pos + node.nodeSize, blockNode(state.schema, block))
    liftOutOfBlockquotes(tr, pos)
  }
  return true
}

const isInsideBlockquote = ($pos: ResolvedPos): boolean => {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "blockquote") return true
  }
  return false
}

const liftOnce = (tr: Transaction, pos: number): number | null => {
  const range = tr.doc.resolve(pos + 1).blockRange()
  if (!range) return null
  const target = liftTarget(range)
  if (target === null) return null

  const stepsBefore = tr.steps.length
  tr.lift(range, target)
  return tr.mapping.slice(stepsBefore).map(pos, 1)
}

// A `>` prefix is not JSON whitespace (RFC 8259 §2), so a fence the serializer
// writes inside a blockquote holds a payload no reader of the block can parse; a
// list item's prefix is spaces, which JSON ignores.
const liftOutOfBlockquotes = (tr: Transaction, pos: number): void => {
  let at: number | null = pos
  while (at !== null && isInsideBlockquote(tr.doc.resolve(at + 1))) at = liftOnce(tr, at)
}
