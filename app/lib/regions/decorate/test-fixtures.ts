import { block } from "~/lib/data-blocks/test-helpers"
import type { RegionRow } from "~/domain/data-blocks/regions/schema"

// # Interview                             sentence 0
// Alice said the funding was approved.    sentence 1
// She thanked the committee.              sentence 2
// Bob objected to the timeline.           sentence 3
// He asked for another month.             sentence 4
export const TRANSCRIPT_PROSE = [
  "# Interview",
  "",
  "Alice said the funding was approved. She thanked the committee.",
  "",
  "Bob objected to the timeline. He asked for another month.",
].join("\n")

export const speakerRegion = (
  value: string,
  start?: number,
  end?: number,
  hit = start ?? 0
): RegionRow => ({
  kind: "speaker",
  parsed: { type: "string", value },
  quote: value,
  hitSentence: hit,
  ...(start === undefined || end === undefined
    ? {}
    : { startSentence: start, endSentence: end, rangeHash: `speaker-${start}-${end}` }),
})

export const dateRegion = (value: string, start: number, end: number): RegionRow => ({
  kind: "date",
  parsed: { type: "datetime", value },
  quote: value,
  hitSentence: start,
  startSentence: start,
  endSentence: end,
  rangeHash: `date-${start}-${end}`,
})

export const regionsBlock = (regions: RegionRow[]): string =>
  block("json-regions", JSON.stringify({ regions, scanned: {} }))

export interface AnnotationFixture {
  text: string
  reason: string
  color: string
  id?: string
}

export const annotationsBlock = (annotations: AnnotationFixture[]): string =>
  block("json-annotations", JSON.stringify({ annotations }))

export const calloutBlock = (id: string): string =>
  block(
    "json-callout",
    JSON.stringify({
      id,
      type: "codebook-code",
      title: "Aside",
      content: "x",
      color: "blue",
      collapsed: false,
    })
  )

export const chartBlock = (id: string): string =>
  block(
    "json-chart",
    JSON.stringify({
      id,
      caption: { label: "Funding" },
      query: "SELECT 1",
      spec: { type: "axis", x: "a", layers: [{ mark: "bar", y: "b", color: "blue" }] },
    })
  )

export const attributesBlock = (): string =>
  block("json-attributes", JSON.stringify({ tags: ["interview"] }))

export const document = (...parts: string[]): string =>
  [TRANSCRIPT_PROSE, "", ...parts, ""].join("\n")
