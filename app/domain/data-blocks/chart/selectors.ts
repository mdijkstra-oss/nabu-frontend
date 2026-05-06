import { ChartSchema, type ChartBlock } from "./schema"
import { getBlocks } from "~/lib/data-blocks/query"
import type { FileStore } from "~/lib/files/store"
import { findIn, findFileFor } from "~/lib/files/collect"

export const getCharts = (raw: string): ChartBlock[] => getBlocks(raw, "json-chart", ChartSchema)

const hasId = (id: string) => (c: ChartBlock) => c.id === id

export const findChartById = (files: FileStore, id: string): ChartBlock | undefined =>
  findIn(files, getCharts, hasId(id))

export const findDocumentForChart = (files: FileStore, id: string): string | undefined =>
  findFileFor(files, getCharts, hasId(id))
