import { getBlockConfig, getSpanField } from "~/lib/data-blocks/registry"
import { isObject } from "~/lib/data-blocks/json"
import { reduceByKind } from "./reduce"
import { resolveDocumentRegions, REGIONS_LANGUAGE, type DocumentRegions } from "./resolve"
import {
  regionsInScope,
  scopeOfDocument,
  scopeOfPoint,
  scopeOfQuote,
  type SentenceScope,
} from "./scope"
import { INFERRED_META, type InferredMeta } from "./schema"

export { INFERRED_META } from "./schema"
export type { InferredMeta, DateSpan } from "./schema"

const withMeta = <T>(parsed: T, meta: InferredMeta | undefined): T =>
  meta === undefined ? parsed : ({ ...parsed, [INFERRED_META]: meta } as T)

const decorateOne = <T>(
  doc: DocumentRegions,
  parsed: T,
  scope: SentenceScope | null,
  excludedKind?: string
): T =>
  scope === null
    ? parsed
    : withMeta(parsed, reduceByKind(regionsInScope(doc.regions, scope, excludedKind)))

const storedRange = (row: Record<string, unknown>): SentenceScope | null =>
  typeof row.startSentence === "number" && typeof row.endSentence === "number"
    ? { first: row.startSentence, last: row.endSentence }
    : null

const scopeOfRow = (
  doc: DocumentRegions,
  language: string,
  row: Record<string, unknown>
): SentenceScope | null => {
  const stored = storedRange(row)
  if (stored) return stored
  const spanField = getSpanField(language)
  const quote = spanField ? row[spanField] : undefined
  return typeof quote === "string" ? scopeOfQuote(doc.prose, doc.sentences, quote) : null
}

const decorateRows = (
  doc: DocumentRegions,
  language: string,
  parsed: Record<string, unknown>,
  rowPath: string
): Record<string, unknown> => {
  const rows = parsed[rowPath]
  if (!Array.isArray(rows)) return parsed

  const excludesOwnKind = language === REGIONS_LANGUAGE
  let changed = false
  const next = rows.map((row) => {
    if (!isObject(row)) return row
    const excludedKind = excludesOwnKind && typeof row.kind === "string" ? row.kind : undefined
    const decorated = decorateOne(doc, row, scopeOfRow(doc, language, row), excludedKind)
    if (decorated !== row) changed = true
    return decorated
  })

  return changed ? { ...parsed, [rowPath]: next } : parsed
}

const scopeOfBlock = (
  doc: DocumentRegions,
  blockStart: number,
  singleton: boolean
): SentenceScope | null => {
  if (singleton) return scopeOfDocument(doc.sentences)
  const anchor = doc.anchors.get(blockStart)
  return anchor === undefined ? null : scopeOfPoint(doc.sentences, anchor)
}

export const decorateParsed = <T>(
  raw: string,
  language: string,
  parsed: T,
  blockStart: number
): T => {
  const value: unknown = parsed
  if (!isObject(value)) return parsed
  const config = getBlockConfig(language)
  if (!config) return parsed
  const doc = resolveDocumentRegions(raw)
  if (doc.regions.length === 0) return parsed

  const remembered = doc.decorated.get(blockStart)
  if (remembered && remembered.parsed === parsed) return remembered.value as T

  const decorated = config.rowPath
    ? decorateRows(doc, language, value, config.rowPath)
    : decorateOne(doc, value, scopeOfBlock(doc, blockStart, config.singleton))
  doc.decorated.set(blockStart, { parsed, value: decorated })
  return decorated as T
}
