import { toDisplayName, isHiddenFile } from "~/lib/files/filename"
import { formatShortDate } from "~/lib/format/date"
import { HIDDEN_TAG_ID } from "~/domain/data-blocks/settings/tags/hidden"
import { getAnnotationCount } from "~/domain/data-blocks/attributes/annotations/selectors"

export type DocSortMode = "name" | "date"

export interface DocumentEntry {
  id: string
  title: string
  date: string
  editedAt: string
  tags: string[]
  annotationCount: number
}

export type GetFileTags = (filename: string) => string[]
export type GetFileDate = (filename: string) => string | undefined

export const buildDocumentEntries = (
  files: Record<string, string>,
  getFileTags: GetFileTags,
  getFileDate: GetFileDate,
  includeHidden: boolean
): DocumentEntry[] =>
  Object.keys(files)
    .filter((filename) => includeHidden || !isHiddenFile(filename))
    .map((filename) => {
      const rawDate = getFileDate(filename) ?? ""
      return {
        id: filename,
        title: toDisplayName(filename),
        date: rawDate,
        editedAt: formatEditedAt(rawDate || undefined),
        tags: tagsWithHidden(getFileTags(filename), filename),
        annotationCount: getAnnotationCount(files[filename] ?? ""),
      }
    })

export const sortDocuments = (entries: DocumentEntry[], mode: DocSortMode): DocumentEntry[] =>
  [...entries].sort(docComparators[mode])

const formatEditedAt = (date: string | undefined): string => (date ? formatShortDate(date) : "")

const tagsWithHidden = (tags: string[], filename: string): string[] =>
  isHiddenFile(filename) ? [...tags, HIDDEN_TAG_ID] : tags

const compareByName = (a: DocumentEntry, b: DocumentEntry): number => a.title.localeCompare(b.title)

const compareByDate = (a: DocumentEntry, b: DocumentEntry): number => {
  if (a.date && b.date) {
    const cmp = b.date.localeCompare(a.date)
    return cmp !== 0 ? cmp : a.title.localeCompare(b.title)
  }
  if (a.date) return -1
  if (b.date) return 1
  return a.title.localeCompare(b.title)
}

const docComparators: Record<DocSortMode, (a: DocumentEntry, b: DocumentEntry) => number> = {
  name: compareByName,
  date: compareByDate,
}
