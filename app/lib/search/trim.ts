import type { SearchHit } from "~/domain/search/types"
import { trimByRanges, SEPARATOR } from "~/lib/text/trim-around"

const stripLonelyEllipses = (text: string): string =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "…")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "")

const splitTrimmedText = (trimmed: string): string[] =>
  trimmed
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

const trimHit = (hit: SearchHit): SearchHit[] => {
  if (!hit.matchRanges || hit.matchRanges.length === 0 || !hit.text) return [hit]
  const trimmed = stripLonelyEllipses(trimByRanges(hit.text, hit.matchRanges))
  if (!trimmed) return [hit]
  const parts = splitTrimmedText(trimmed)
  if (parts.length === 0) return []
  if (parts.length === 1) return [{ ...hit, text: parts[0] }]
  return parts.map((text, i) => ({
    ...hit,
    text,
    splitIndex: i,
    splitTotal: parts.length,
  }))
}

export const trim = (hits: SearchHit[]): SearchHit[] => hits.flatMap(trimHit)
