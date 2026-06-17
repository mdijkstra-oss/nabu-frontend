import { parseCodeBlocks, type CodeBlock } from "~/lib/data-blocks/parse"
import { isSingleton } from "~/lib/data-blocks/registry"

const PREVIEW_CHARS = 4000 // ~1k tokens

const cutAt = (blocks: CodeBlock[], budget: number): number => {
  const straddling = blocks.find((b) => b.start < budget && budget < b.end)
  return straddling ? straddling.start : budget
}

export const previewContent = (content: string): string => {
  if (content.length <= PREVIEW_CHARS) return content
  const blocks = parseCodeBlocks(content)
  const cut = cutAt(blocks, PREVIEW_CHARS)
  const head = content.slice(0, cut).trimEnd()
  const droppedSingletons = blocks
    .filter((b) => isSingleton(b.language) && b.start >= cut)
    .map((b) => content.slice(b.start, b.end))
  return droppedSingletons.length > 0 ? `${head}\n\n${droppedSingletons.join("\n\n")}` : head
}
