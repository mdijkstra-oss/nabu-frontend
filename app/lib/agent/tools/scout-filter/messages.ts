import type { Segment, Splitter } from "~/lib/text/types"
import { splitByParagraphs } from "~/lib/text/split"
import { charOffsetToLine } from "~/lib/text/lines"

interface Message {
  type: "message"
  role: "system" | "user"
  content: string
}

export interface NumberedParagraph {
  index: number
  text: string
  startLine: number
  endLine: number
}

const segmentToLineRange = (content: string, segment: Segment): { start: number; end: number } => {
  const startLine = charOffsetToLine(content, segment.start) + 1
  const endLine = charOffsetToLine(content, segment.end - 1) + 1
  return { start: startLine, end: endLine }
}

export const numberParagraphs = (
  content: string,
  splitter: Splitter = splitByParagraphs
): NumberedParagraph[] =>
  splitter(content).map((segment, i) => {
    const range = segmentToLineRange(content, segment)
    return {
      index: i + 1,
      text: segment.text,
      startLine: range.start,
      endLine: range.end,
    }
  })

const formatNumberedParagraphs = (paragraphs: NumberedParagraph[]): string =>
  paragraphs.map((p) => `[${p.index}]\n${p.text}`).join("\n\n")

const CTA = "Return paragraph numbers to exclude from analysis."

export const buildScoutFilterMessages = (
  framework: string,
  paragraphs: NumberedParagraph[]
): Message[] => [
  { type: "message", role: "system", content: framework },
  { type: "message", role: "system", content: formatNumberedParagraphs(paragraphs) },
  { type: "message", role: "user", content: CTA },
]
