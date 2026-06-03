import type { FileStore } from "~/lib/files/store"
import { toDisplayName } from "~/lib/files/filename"
import { getCharts } from "~/domain/data-blocks/chart/selectors"
import type { ChartBlock } from "~/domain/data-blocks/chart/schema"
import type { ChartType } from "~/lib/chart/types"
import { exhaustive } from "~/lib/utils/exhaustive"
import type { ExhibitItem, ChartSubtype, ExhibitKind } from "./types"

export const inferChartSubtype = (type: ChartType): ChartSubtype => {
  switch (type) {
    case "bar":
    case "stacked-bar":
    case "grouped-bar":
      return "bar"
    case "line":
    case "area":
      return "line"
    case "pie":
    case "treemap":
      return "pie"
    case "scatter":
      return "scatter"
    case "heatmap":
      return "other"
    default:
      return exhaustive(type)
  }
}

const chartToExhibit = (chart: ChartBlock, filename: string): ExhibitItem => ({
  id: chart.id,
  title: chart.caption.label,
  kind: "chart",
  subtype: inferChartSubtype(chart.spec.type),
  documentId: filename,
  documentTitle: toDisplayName(filename),
})

export const collectExhibits = (files: FileStore): ExhibitItem[] =>
  Object.entries(files).flatMap(([filename, raw]) =>
    getCharts(raw).map((chart) => chartToExhibit(chart, filename))
  )

export interface ExhibitGroup {
  kind: ExhibitKind
  items: ExhibitItem[]
}

export const groupByKind = (exhibits: ExhibitItem[]): ExhibitGroup[] => {
  const kindMap = new Map<ExhibitKind, ExhibitItem[]>()
  for (const exhibit of exhibits) {
    const existing = kindMap.get(exhibit.kind)
    if (existing) existing.push(exhibit)
    else kindMap.set(exhibit.kind, [exhibit])
  }
  return Array.from(kindMap, ([kind, items]) => ({ kind, items }))
}
