import type { Spotlight } from "./types"
import type { Segment } from "~/lib/text/types"
import { exhaustive } from "~/lib/utils/exhaustive"
import { stripBlocksByLanguage } from "~/lib/data-blocks/parse"
import { splitMarkdownBySentences } from "~/lib/text/split"
import { stripMarkdown } from "~/lib/text/strip"
import { tokenizeWords } from "~/lib/text/find"

const RANGE_DELIMITER = "..."

const serializeSpotlight = (spotlight: Spotlight): string => {
  switch (spotlight.type) {
    case "single":
      return spotlight.text
    case "range":
      return `${spotlight.from}${RANGE_DELIMITER}${spotlight.to}`
    default:
      return exhaustive(spotlight)
  }
}

const toUrlParam = (text: string): string => text.replace(/ /g, "+")

export const serializeSpotlightParam = (spotlight: Spotlight): string =>
  toUrlParam(serializeSpotlight(spotlight))

const longestSegment = (segments: Segment[]): Segment | null =>
  segments.reduce<Segment | null>(
    (best, seg) => (!best || seg.text.length > best.text.length ? seg : best),
    null
  )

const stripAnnotations = (text: string): string => stripBlocksByLanguage(text, "json-annotations")

const splitSentences = splitMarkdownBySentences()

const toSpotlight = (raw: string): Spotlight | null => {
  const clean = stripMarkdown(raw)
  const tokens = tokenizeWords(clean)
  if (tokens.length === 0) return null
  return { type: "single", text: tokens.join(" ") }
}

export const spotlightFromText = (text: string): Spotlight | null => {
  const prose = stripAnnotations(text)
  const sentences = splitSentences(prose)
  const longest = longestSegment(sentences)
  if (!longest) return null
  return toSpotlight(longest.text)
}

const longestString = (strings: string[]): string | null =>
  strings.reduce<string | null>((best, s) => (!best || s.length > best.length ? s : best), null)

export const spotlightFromMatches = (matches: string[]): Spotlight | null => {
  const longest = longestString(matches)
  if (!longest) return null
  return toSpotlight(longest)
}
