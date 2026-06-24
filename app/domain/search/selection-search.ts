import type { FileStore } from "~/lib/files/store"
import type { NewSearchData, SearchEntry, SearchHit } from "~/domain/search/types"
import { previewContent } from "~/domain/documents/preview"
import { escapeSqlString } from "./queries"

export const SELECTION_KIND = "selection"
const ORDER_SEP = "\n"

const selectionSql = (orderedDocIds: string[]): string =>
  orderedDocIds.length === 0
    ? "SELECT file FROM annotations WHERE 1=0"
    : `SELECT file FROM annotations WHERE file IN (${orderedDocIds
        .map((id) => `'${escapeSqlString(id)}'`)
        .join(", ")})`

export const buildSelectionEntry = (orderedDocIds: string[]): NewSearchData => ({
  title: `${orderedDocIds.length} document${orderedDocIds.length === 1 ? "" : "s"}`,
  description: "Selected documents",
  sql: selectionSql(orderedDocIds),
  meta: { kind: SELECTION_KIND, selectionOrder: orderedDocIds.join(ORDER_SEP) },
})

export const isSelectionSearch = (entry: SearchEntry | undefined): boolean =>
  entry?.meta?.kind === SELECTION_KIND

export const parseSelectionOrder = (entry: SearchEntry): string[] => {
  const raw = entry.meta?.selectionOrder ?? ""
  return raw.length === 0 ? [] : raw.split(ORDER_SEP)
}

export const selectionHits = (files: FileStore, orderedDocIds: string[]): SearchHit[] =>
  orderedDocIds
    .filter((id) => files[id] !== undefined)
    .map((id) => ({ file: id, text: previewContent(files[id]) }))
