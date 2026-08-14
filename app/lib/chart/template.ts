import {
  bindingField,
  isAxisSpec,
  isMatrixSpec,
  isPartSpec,
  type ChartEntityMap,
  type ChartSpec,
  type FieldBinding,
  type TemplateNode,
  type TemplateRefOp,
} from "./types"
import { formatValue } from "./format"
import { exhaustive } from "~/lib/utils/exhaustive"

export interface TemplateContext {
  row: Record<string, unknown>
  entityMap: ChartEntityMap
}

const ENTITY_PROPERTIES = ["color", "name", "label"] as const
type EntityProperty = (typeof ENTITY_PROPERTIES)[number]

const isEntityProperty = (value: string): value is EntityProperty =>
  (ENTITY_PROPERTIES as readonly string[]).includes(value)

const TEMPLATE_PATTERN = /\{([^{}]+)\}/g

export const isTemplate = (value: string): boolean => {
  TEMPLATE_PATTERN.lastIndex = 0
  return TEMPLATE_PATTERN.test(value)
}

const refOpFromTail = (tail: string): TemplateRefOp =>
  isEntityProperty(tail) ? { kind: "property", property: tail } : { kind: "format", format: tail }

const parseRef = (inner: string): TemplateNode => {
  const colonIndex = inner.indexOf(":")
  if (colonIndex === -1) {
    return { type: "ref", field: inner.trim(), op: { kind: "raw" } }
  }
  const field = inner.slice(0, colonIndex).trim()
  const tail = inner.slice(colonIndex + 1).trim()
  return { type: "ref", field, op: refOpFromTail(tail) }
}

export const parseTemplate = (input: string): TemplateNode[] => {
  const nodes: TemplateNode[] = []
  let lastIndex = 0
  TEMPLATE_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TEMPLATE_PATTERN.exec(input)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "literal", value: input.slice(lastIndex, match.index) })
    }
    nodes.push(parseRef(match[1]))
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < input.length) {
    nodes.push({ type: "literal", value: input.slice(lastIndex) })
  }
  return nodes
}

const lookupEntityProperty = (
  entityMap: ChartEntityMap,
  id: unknown,
  property: EntityProperty
): string | undefined => {
  if (typeof id !== "string") return undefined
  const entity = entityMap[id]
  if (!entity) return undefined
  if (property === "color") return entity.color
  if (property === "name" || property === "label") return entity.label
  return undefined
}

const stringifyRawMarkdown = (value: unknown, entityMap: ChartEntityMap): string => {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") {
    const entity = entityMap[value]
    if (entity) return `[${entity.label}](file://${value})`
    return value
  }
  return String(value)
}

export const resolveTemplateToMarkdown = (
  nodes: readonly TemplateNode[],
  context: TemplateContext
): string =>
  nodes
    .map((node) => {
      if (node.type === "literal") return node.value
      const raw = context.row[node.field]
      if (node.op.kind === "raw") return stringifyRawMarkdown(raw, context.entityMap)
      if (node.op.kind === "format") return formatValue(raw, node.op.format)
      return lookupEntityProperty(context.entityMap, raw, node.op.property) ?? ""
    })
    .join("")

const collectRefFields = (template: string): string[] =>
  parseTemplate(template)
    .filter((n): n is Extract<TemplateNode, { type: "ref" }> => n.type === "ref")
    .map((n) => n.field)

const collectBindingFields = (spec: ChartSpec): FieldBinding[] => {
  if (isAxisSpec(spec))
    return [
      spec.x,
      ...spec.layers.flatMap((layer) => [layer.y, ...(layer.series ? [layer.series] : [])]),
    ]
  if (isPartSpec(spec)) return [spec.label, spec.value, ...(spec.parent ? [spec.parent] : [])]
  if (isMatrixSpec(spec)) return [spec.x, spec.y, spec.value]
  return exhaustive(spec)
}

const collectColorTemplates = (spec: ChartSpec): string[] => {
  if (isAxisSpec(spec)) return spec.layers.map((layer) => layer.color)
  return [spec.color]
}

export const collectReferencedFields = (spec: ChartSpec): string[] => {
  const fields = new Set<string>()
  for (const binding of collectBindingFields(spec)) {
    fields.add(bindingField(binding))
  }
  for (const color of collectColorTemplates(spec)) {
    if (isTemplate(color)) {
      for (const field of collectRefFields(color)) fields.add(field)
    }
  }
  if (spec.tooltip) {
    for (const field of collectRefFields(spec.tooltip)) fields.add(field)
  }
  return [...fields]
}
