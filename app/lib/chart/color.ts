import { BLOCK_COLORS } from "~/ui/theme/colors"
import type { ChartEntityMap, TemplateNode } from "./types"

export type ResolveRadix = (token: string, shade: number) => string

export const FALLBACK_COLOR = "#888888"
export const CHART_COLOR_SHADE = 9

export interface ColorContext {
  entityMap: ChartEntityMap
  resolveRadix: ResolveRadix
  shade: number
  fallback: string
}

const RADIX_TOKENS = new Set<string>(BLOCK_COLORS)

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

const isHex = (value: string): boolean => HEX_PATTERN.test(value)

const isRadixToken = (value: string): boolean => RADIX_TOKENS.has(value)

const resolveAtomicColor = (value: string, context: ColorContext): string | undefined => {
  if (isHex(value)) return value
  if (isRadixToken(value)) return context.resolveRadix(value, context.shade)
  return undefined
}

export const resolveChartColor = (value: string, context: ColorContext): string => {
  const atomic = resolveAtomicColor(value, context)
  if (atomic) return atomic
  const entity = context.entityMap[value]
  if (entity) {
    const viaEntity = resolveAtomicColor(entity.color, context)
    if (viaEntity) return viaEntity
  }
  return context.fallback
}

const evaluateColorNode = (
  node: TemplateNode,
  row: Record<string, unknown>,
  entityMap: ChartEntityMap
): string => {
  if (node.type === "literal") return node.value
  if (node.op.kind === "property" && node.op.property === "color") {
    const id = row[node.field]
    if (typeof id !== "string") return ""
    return entityMap[id]?.color ?? ""
  }
  if (node.op.kind === "raw") {
    const raw = row[node.field]
    return typeof raw === "string" ? raw : ""
  }
  throw new Error(`color template: unsupported op ${JSON.stringify(node.op)}`)
}

const evaluateColorTemplate = (
  nodes: readonly TemplateNode[],
  row: Record<string, unknown>,
  entityMap: ChartEntityMap
): string => {
  if (nodes.length === 0) return ""
  if (nodes.length > 1) {
    throw new Error("color template must be a single node (literal, {field}, or {field:color})")
  }
  return evaluateColorNode(nodes[0], row, entityMap)
}

export const resolveRowColor = (
  nodes: readonly TemplateNode[],
  row: Record<string, unknown>,
  context: ColorContext
): string => {
  const raw = evaluateColorTemplate(nodes, row, context.entityMap)
  if (!raw) return context.fallback
  return resolveChartColor(raw, context)
}
