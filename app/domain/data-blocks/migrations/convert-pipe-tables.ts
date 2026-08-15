import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import type { Nodes, Table, TableCell } from "mdast"
import type { MarkdownMigration } from "~/lib/data-blocks/migrate"
import { formatBlock, formatBlockJson } from "~/lib/data-blocks/parse"
import { pipeTableToBlock, type PipeTable } from "~/domain/data-blocks/table/from-pipe-table"

export const convertPipeTables: MarkdownMigration = {
  matches: (markdown) => findTables(withoutBom(markdown)).length > 0,
  upgrade: (markdown) => leadingBom(markdown) + convertTables(withoutBom(markdown)),
}

const parser = unified().use(remarkParse).use(remarkGfm)

// micromark strips a leading byte order mark before parsing, so every mdast
// offset counts from the character after it.
const BOM = "﻿"

const leadingBom = (markdown: string): string => (markdown.startsWith(BOM) ? BOM : "")

const withoutBom = (markdown: string): string => markdown.slice(leadingBom(markdown).length)

interface LocatedTable {
  table: Table
  start: number
  end: number
}

const convertTables = (markdown: string): string =>
  findTables(markdown).reverse().reduce(replaceTable, markdown)

const findTables = (markdown: string): LocatedTable[] => {
  const found: LocatedTable[] = []

  const walk = (node: Nodes): void => {
    if (node.type === "table") {
      const { start, end } = node.position ?? {}
      if (start?.offset !== undefined && end?.offset !== undefined) {
        found.push({ table: node, start: start.offset, end: end.offset })
      }
      return
    }
    if ("children" in node) {
      for (const child of node.children) walk(child)
    }
  }

  walk(parser.parse(markdown))
  return found
}

// A cell's own position spans its leading pipe and its padding; the span of its
// children is the inner text. Escaped pipes are the one gfm escape inside a cell.
const cellText = (markdown: string, cell: TableCell): string => {
  const first = cell.children.at(0)?.position?.start.offset
  const last = cell.children.at(-1)?.position?.end.offset
  if (first === undefined || last === undefined) return ""
  return markdown.slice(first, last).replace(/\\\|/g, "|")
}

const readTable = (markdown: string, table: Table): PipeTable => {
  const [header = [], ...rows] = table.children.map((row) =>
    row.children.map((cell) => cellText(markdown, cell))
  )
  return { header, rows }
}

const lineStartOf = (markdown: string, offset: number): number =>
  markdown.lastIndexOf("\n", offset - 1) + 1

const lineEndOf = (markdown: string, offset: number): number => {
  const newline = markdown.indexOf("\n", offset)
  return newline === -1 ? markdown.length : newline
}

const linePrefixOf = (markdown: string, start: number): string =>
  markdown.slice(lineStartOf(markdown, start), start)

const isInsideBlockquote = (markdown: string, start: number): boolean =>
  linePrefixOf(markdown, start).includes(">")

// A `>` prefix is not JSON whitespace (RFC 8259 §2), so a fence carrying
// blockquote markers holds a payload no reader of the block can parse; a list
// item's prefix is spaces, which JSON ignores.
const fencePrefix = (markdown: string, start: number): string =>
  isInsideBlockquote(markdown, start) ? "" : linePrefixOf(markdown, start).replace(/\S/g, " ")

// mdast puts a table's position at its first `|`, after any container prefix, so
// a lifted fence has to take the whole lines the table sat on or the `> ` markers
// it left behind become a quote of their own.
const replacedRange = (markdown: string, { start, end }: LocatedTable): [number, number] =>
  isInsideBlockquote(markdown, start)
    ? [lineStartOf(markdown, start), lineEndOf(markdown, end)]
    : [start, end]

const withPrefix = (text: string, prefix: string): string =>
  text
    .split("\n")
    .map((line, index) => (index === 0 ? line : prefix + line))
    .join("\n")

const toFence = (markdown: string, { table, start }: LocatedTable): string => {
  const block = pipeTableToBlock(readTable(markdown, table))
  return withPrefix(formatBlock("json-table", formatBlockJson(block)), fencePrefix(markdown, start))
}

const replaceTable = (markdown: string, located: LocatedTable): string => {
  const [start, end] = replacedRange(markdown, located)
  return markdown.slice(0, start) + toFence(markdown, located) + markdown.slice(end)
}
