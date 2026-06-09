import type { CodedItem, ItemMapping, PresentedSection } from "./present"

const formatCodings = (codings: string[]): string => codings.join(", ")

const joinNonEmpty = (parts: string[]): string => parts.filter(Boolean).join(" ")

const buildBlock = (
  sentences: string[],
  item: CodedItem,
  itemIndex: number,
  halo: number,
  leading: string,
  trailing: string
): string => {
  const sectionBeforeCount = Math.min(halo, item.start - 1)
  const sectionBefore = sentences
    .slice(item.start - 1 - sectionBeforeCount, item.start - 1)
    .join(" ")
  const needsLeadingSpill = halo > sectionBeforeCount

  const sectionAfterCount = Math.min(halo, sentences.length - item.end)
  const sectionAfter = sentences.slice(item.end, item.end + sectionAfterCount).join(" ")
  const needsTrailingSpill = halo > sectionAfterCount

  const beforeText = joinNonEmpty([needsLeadingSpill ? leading : "", sectionBefore])
  const afterText = joinNonEmpty([sectionAfter, needsTrailingSpill ? trailing : ""])

  const candidateText = sentences.slice(item.start - 1, item.end).join(" ")
  const label = item.id ?? String(itemIndex)
  const codeAttr = formatCodings(item.codings)

  const lines: string[] = ["[target]"]
  if (beforeText) lines.push(beforeText)
  lines.push(`[candidate id="${label}" code="${codeAttr}"]${candidateText}[/candidate]`)
  if (afterText) lines.push(afterText)
  lines.push("[/target]")
  return lines.join("\n")
}

export interface TripletEdge {
  leading: string
  trailing: string
}

export const renderTripletSection = (
  sentences: string[],
  items: CodedItem[],
  halo: number,
  edge: TripletEdge
): PresentedSection => {
  const mapping: ItemMapping[] = items.map((item, i) => ({
    index: i + 1,
    start: item.start,
    end: item.end,
    codings: item.codings,
  }))

  const blocks = items.map((item, i) =>
    buildBlock(sentences, item, i + 1, halo, edge.leading, edge.trailing)
  )

  return { text: blocks.join("\n\n"), mapping }
}
