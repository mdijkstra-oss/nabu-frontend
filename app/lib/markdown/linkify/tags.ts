type TagResolver = (label: string) => { id: string; display: string } | null

export const SLUG_PATTERN = /[a-z0-9]+(-[a-z0-9]+)*/
const TAG_PATTERN = new RegExp(`\`[^\`]*\`|\\[[^\\]]*\\]\\([^)]+\\)|#(${SLUG_PATTERN.source})`, "g")

const TAG_MARKER = /#[a-z0-9]/

const needsTagScan = (text: string): boolean => TAG_MARKER.test(text)

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /\w/.test(ch)

export const linkifyTags = (text: string, resolveTag: TagResolver): string => {
  if (!needsTagScan(text)) return text
  const pattern = new RegExp(TAG_PATTERN.source, "g")
  let result = ""
  let lastIndex = 0

  while (true) {
    pattern.lastIndex = lastIndex
    const match = pattern.exec(text)
    if (!match) break

    const label = match[1]
    if (!label) {
      result += text.slice(lastIndex, match.index + match[0].length)
      lastIndex = match.index + match[0].length
      continue
    }

    const charBefore = text[match.index - 1]
    if (isWordChar(charBefore)) {
      result += text.slice(lastIndex, match.index + match[0].length)
      lastIndex = match.index + match[0].length
      continue
    }

    const resolved = resolveTag(label)
    if (!resolved) {
      result += text.slice(lastIndex, match.index + match[0].length)
      lastIndex = match.index + match[0].length
      continue
    }

    result += text.slice(lastIndex, match.index)
    result += `[${resolved.display}](file://${resolved.id})`
    lastIndex = match.index + match[0].length
  }

  result += text.slice(lastIndex)
  return result
}
