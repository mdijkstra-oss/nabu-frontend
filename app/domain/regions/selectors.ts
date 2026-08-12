import { isResolved, type ResolvedRegionRow } from "~/domain/data-blocks/regions/schema"
import { formatDisplayDate } from "~/lib/format/date"
import type { RenderableRegion } from "~/lib/editor/regions/types"
import { resolveDocumentRegions } from "~/lib/regions/decorate/resolve"
import { getKind, regionKinds, type KindDescriptor } from "~/lib/regions/kinds/registry"

export interface RenderableRegions {
  regions: RenderableRegion[]
  sentences: string[]
}

const EMPTY: RenderableRegions = { regions: [], sentences: [] }

const declarationOrder = new Map(regionKinds().map((kind, order) => [kind.id, order]))

const displayValue = (kind: KindDescriptor, value: string): string =>
  kind.valueType === "datetime" ? formatDisplayDate(value) : value

const toRenderable = (row: ResolvedRegionRow, index: number): RenderableRegion | null => {
  const kind = getKind(row.kind)
  if (!kind) return null
  return {
    index,
    kind: kind.id,
    kindOrder: declarationOrder.get(kind.id) ?? 0,
    label: displayValue(kind, row.parsed.value),
    colour: kind.color,
    icon: kind.icon,
    quote: row.quote,
    hitSentence: row.hitSentence,
    startSentence: row.startSentence,
    endSentence: row.endSentence,
  }
}

export const getRenderableRegions = (raw: string): RenderableRegions => {
  const { regions, sentences } = resolveDocumentRegions(raw)
  const rows = regions.filter(isResolved)
  if (rows.length === 0) return EMPTY
  return {
    regions: rows.flatMap((row, index) => {
      const renderable = toRenderable(row, index)
      return renderable ? [renderable] : []
    }),
    sentences: sentences.map((sentence) => sentence.text),
  }
}
