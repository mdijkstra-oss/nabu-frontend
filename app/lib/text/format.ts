import { splitBySentences } from "./split"

interface NumberedPassageOpts {
  prefix?: string
  offset?: number
  separator?: string
}

const splitSentenceTexts = splitBySentences()

const PARAGRAPH_BREAK = "\n\n"
const SPACE = " "

const isParagraphGap = (source: string, fromEnd: number, toStart: number): boolean =>
  source.slice(fromEnd, toStart).includes("\n\n")

export const formatNumberedPassage = (text: string, opts: NumberedPassageOpts = {}): string => {
  const { prefix = "", offset = 0, separator = "" } = opts
  const segments = splitSentenceTexts(text)
  if (segments.length === 0) return ""
  const sep = prefix === "" ? "" : separator

  const parts: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (i > 0) {
      const gap = isParagraphGap(text, segments[i - 1].end, seg.start) ? PARAGRAPH_BREAK : SPACE
      parts.push(gap)
    }
    parts.push(`[${prefix}${sep}${offset + i + 1}] ${seg.text}`)
  }
  return parts.join("")
}
