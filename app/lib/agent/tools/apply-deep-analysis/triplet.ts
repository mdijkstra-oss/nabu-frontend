import type { CodedItem, ItemMapping } from "./present"

const formatCodings = (codings: string[]): string => codings.join(", ")

const buildTargetBlock = (
  sentences: string[],
  item: CodedItem,
  itemIndex: number,
  halo: number
): string => {
  const beforeCount = Math.min(halo, item.start - 1)
  const before = sentences.slice(item.start - 1 - beforeCount, item.start - 1).join(" ")

  const afterCount = Math.min(halo, sentences.length - item.end)
  const after = sentences.slice(item.end, item.end + afterCount).join(" ")

  const candidateText = sentences.slice(item.start - 1, item.end).join(" ")
  const label = item.id ?? String(itemIndex)
  const codeAttr = formatCodings(item.codings)

  const lines: string[] = [`<target id="${label}" code="${codeAttr}">`]
  if (before) lines.push(before)
  lines.push(`<marked>${candidateText}</marked>`)
  if (after) lines.push(after)
  if (item.keepCase !== undefined) lines.push(`<keep-case>${item.keepCase}</keep-case>`)
  if (item.removeCase !== undefined) lines.push(`<remove-case>${item.removeCase}</remove-case>`)
  lines.push("</target>")
  return lines.join("\n")
}

export interface RenderedTargets {
  blocks: string[]
  mapping: ItemMapping[]
}

export const renderTargetBlocks = (
  sentences: string[],
  items: CodedItem[],
  halo: number
): RenderedTargets => {
  const mapping: ItemMapping[] = items.map((item, i) => ({
    index: i + 1,
    start: item.start,
    end: item.end,
    codings: item.codings,
  }))

  const blocks = items.map((item, i) => buildTargetBlock(sentences, item, i + 1, halo))
  return { blocks, mapping }
}
