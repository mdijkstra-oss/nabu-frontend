import type { SearchHit, SearchEntry } from "./types"
import type { FileStore } from "~/lib/files/store"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import { extractProse } from "~/lib/data-blocks/parse"
import { toDisplayName } from "~/lib/files/filename"
import { getStoredAnnotations } from "~/domain/data-blocks/attributes/annotations/selectors"
import { getCodeTitle } from "~/domain/data-blocks/callout/codes/selectors"
import { CONTEXT_PREFIX } from "~/lib/editor/chat-context"

const MAX_CONTEXT_RESULTS = 8

const formatCodedAnnotation = (annotation: Annotation, files: FileStore): string | null => {
  if (!annotation.code) return null
  const title = getCodeTitle(files, annotation.code) ?? annotation.code
  return `  - coded with: ${title} (${annotation.id ?? "no-id"})`
}

const formatSearchHit = (hit: SearchHit, files: FileStore): string => {
  const display = toDisplayName(hit.file)
  if (!hit.text) return `- ${display}`

  const prose = extractProse(hit.text).trim()
  const annotations = getStoredAnnotations(hit.text)
  const codedLines = annotations
    .map((a) => formatCodedAnnotation(a, files))
    .filter((l): l is string => l !== null)

  return [`- ${display}: ${prose}`, ...codedLines].join("\n")
}

export const buildSearchContextMessage = (
  search: SearchEntry,
  results: SearchHit[],
  files: FileStore
): string => {
  const preview = results.slice(0, MAX_CONTEXT_RESULTS)
  const lines = [
    CONTEXT_PREFIX,
    `Search: "${search.title}" (${search.id})`,
    `Description: ${search.description}`,
    `Query: ${search.sql}`,
  ]
  if (preview.length > 0) {
    lines.push("", "Sample results:", ...preview.map((h) => formatSearchHit(h, files)))
  }
  return lines.join("\n")
}
