import { Schema, type Node } from "prosemirror-model"

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    bullet_list: { group: "block", content: "list_item+" },
    list_item: { content: "paragraph block*" },
    code_block: {
      group: "block",
      content: "text*",
      code: true,
      attrs: { language: { default: null } },
    },
    text: { group: "inline" },
  },
  marks: { strong: {}, link: { attrs: { href: { default: "" } } } },
})

export interface Run {
  text: string
  bold?: boolean
  href?: string
}

interface RunsDef {
  runs: Run[]
}

interface HeadingDef {
  heading: string
}

interface CodeDef {
  code: string
  language?: string
}

interface BulletsDef {
  bullets: (BlockDef | ItemDef)[]
}

export interface ItemDef {
  item: BlockDef
  nested?: BlockDef[]
}

export type BlockDef = string | RunsDef | HeadingDef | BulletsDef | CodeDef

const isCode = (def: BlockDef): def is CodeDef => typeof def !== "string" && "code" in def

const isHeading = (def: BlockDef): def is HeadingDef => typeof def !== "string" && "heading" in def

const isBullets = (def: BlockDef): def is BulletsDef => typeof def !== "string" && "bullets" in def

const isRuns = (def: BlockDef): def is RunsDef => typeof def !== "string" && "runs" in def

const isItem = (def: BlockDef | ItemDef): def is ItemDef => typeof def !== "string" && "item" in def

const marksOf = (run: Run) => [
  ...(run.bold ? [schema.marks.strong.create()] : []),
  ...(run.href ? [schema.marks.link.create({ href: run.href })] : []),
]

const toInline = (run: Run) => schema.text(run.text, marksOf(run))

const toListItem = (def: BlockDef | ItemDef): Node => {
  if (!isItem(def)) return schema.nodes.list_item.create(null, toNode(def))
  const nested = def.nested ? [toBulletList(def.nested)] : []
  return schema.nodes.list_item.create(null, [toNode(def.item), ...nested])
}

const toBulletList = (items: (BlockDef | ItemDef)[]): Node =>
  schema.nodes.bullet_list.create(null, items.map(toListItem))

const toNode = (def: BlockDef): Node => {
  if (isCode(def))
    return schema.nodes.code_block.create(
      { language: def.language ?? null },
      def.code ? schema.text(def.code) : null
    )
  if (isHeading(def)) return schema.nodes.heading.create(null, schema.text(def.heading))
  if (isBullets(def)) return toBulletList(def.bullets)
  if (isRuns(def)) return schema.nodes.paragraph.create(null, def.runs.map(toInline))
  return schema.nodes.paragraph.create(null, def ? schema.text(def) : null)
}

export const createDoc = (blocks: BlockDef[]): Node =>
  schema.nodes.doc.create(null, blocks.map(toNode))
