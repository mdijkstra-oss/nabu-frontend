import { getEntityPrefixes } from "~/lib/data-blocks/registry"

type NameResolver = (id: string) => string | null
type MissingFormatter = (id: string) => string | null

const buildEntityIdPattern = (prefixes: string[]): RegExp => {
  const prefixAlt = prefixes.join("|")
  return new RegExp(
    `\\[[^\\]]*\\]\\([^)]+\\)|((?:${prefixAlt})-[a-z0-9]{6,10}|[\\w][\\w-]*\\.md)`,
    "gi"
  )
}

const needsEntityScan = (text: string, prefixes: string[]): boolean => {
  const lower = text.toLowerCase()
  return prefixes.some((p) => lower.includes(p + "-")) || lower.includes(".md")
}

const WRAPPERS = new Set(["(", ")", "`", "*", "_"])
const QUOTES = new Set(['"', "'"])
const FILE_PROTOCOL = "file://"
const MAX_GLUE = 8

const isFileEntity = (id: string): boolean => id.endsWith(".md")

const expandQuotes = (
  text: string,
  start: number,
  end: number,
  floor: number
): [number, number] => {
  if (start > floor && QUOTES.has(text[start - 1]) && text[end] === text[start - 1])
    return [start - 1, end + 1]
  return [start, end]
}

const isPartOfFileUrl = (text: string, start: number): boolean =>
  start >= FILE_PROTOCOL.length && text.slice(start - FILE_PROTOCOL.length, start) === FILE_PROTOCOL

const expandWrappers = (
  text: string,
  start: number,
  end: number,
  floor: number
): [number, number] => {
  while (start > floor && WRAPPERS.has(text[start - 1])) start--
  while (end < text.length && WRAPPERS.has(text[end])) end++
  return [start, end]
}

const tryStripAfter = (text: string, offset: number, name: string): number => {
  for (let gap = 1; gap <= MAX_GLUE && offset + gap < text.length; gap++) {
    if (text[offset + gap - 1] === "\n") break
    if (text.slice(offset + gap, offset + gap + name.length) !== name) continue
    const afterName = offset + gap + name.length
    if (afterName < text.length && /\w/.test(text[afterName])) continue
    let end = afterName
    while (end < text.length && WRAPPERS.has(text[end])) end++
    return end - offset
  }
  return 0
}

const tryStripBefore = (before: string, name: string): number => {
  for (let gap = 1; gap <= MAX_GLUE && gap < before.length; gap++) {
    if (before[before.length - gap] === "\n") break
    const nameStart = before.length - gap - name.length
    if (nameStart < 0) continue
    if (before.slice(nameStart, nameStart + name.length) !== name) continue
    if (nameStart > 0 && /\w/.test(before[nameStart - 1])) continue
    let start = nameStart
    while (start > 0 && WRAPPERS.has(before[start - 1])) start--
    return before.length - start
  }
  return 0
}

export const resolveIdentifiers = (text: string, resolveName: NameResolver): string => {
  const prefixes = getEntityPrefixes()
  if (!needsEntityScan(text, prefixes)) return text
  const pattern = buildEntityIdPattern(prefixes)
  return text.replace(pattern, (match, rawId: string | undefined) => {
    if (!rawId) return match
    const bareId = isFileEntity(rawId) ? rawId : rawId.toLowerCase()
    return resolveName(bareId) ?? match
  })
}

export const linkifyEntityIds = (
  text: string,
  resolveName: NameResolver,
  formatMissing?: MissingFormatter
): string => {
  const prefixes = getEntityPrefixes()
  if (!needsEntityScan(text, prefixes)) return text
  const pattern = buildEntityIdPattern(prefixes)
  let result = ""
  let lastIndex = 0

  while (true) {
    pattern.lastIndex = lastIndex
    const match = pattern.exec(text)
    if (!match) break

    const rawId = match[1]
    if (!rawId) {
      result += text.slice(lastIndex, match.index + match[0].length)
      lastIndex = match.index + match[0].length
      continue
    }
    const bareId = isFileEntity(rawId) ? rawId : rawId.toLowerCase()

    const name = resolveName(bareId)
    if (!name) {
      const fallback = formatMissing?.(bareId)
      if (!fallback || isPartOfFileUrl(text, match.index)) {
        result += text.slice(lastIndex, match.index + match[0].length)
        lastIndex = match.index + match[0].length
        continue
      }

      const [fwStart, fwEnd] = expandWrappers(
        text,
        match.index,
        match.index + match[0].length,
        lastIndex
      )
      const [fStart, fEnd] = isFileEntity(bareId)
        ? expandQuotes(text, fwStart, fwEnd, lastIndex)
        : [fwStart, fwEnd]
      result += text.slice(lastIndex, fStart) + fallback
      lastIndex = fEnd
      continue
    }

    const [wrapStart, wrapEnd] = expandWrappers(
      text,
      match.index,
      match.index + match[0].length,
      lastIndex
    )

    const hasFileProtocol = isPartOfFileUrl(text, match.index)

    const protocolOffset = hasFileProtocol ? FILE_PROTOCOL.length : 0
    const [consumeStart, consumeEnd] = expandQuotes(
      text,
      wrapStart - protocolOffset,
      wrapEnd,
      lastIndex
    )

    const link = `[${name}](file://${bareId})`

    const stripAfter = tryStripAfter(text, consumeEnd, name)
    if (stripAfter > 0) {
      result += text.slice(lastIndex, consumeStart) + link
      lastIndex = consumeEnd + stripAfter
      continue
    }

    const before = text.slice(lastIndex, consumeStart)
    const stripBefore = tryStripBefore(before, name)
    if (stripBefore > 0) {
      result += before.slice(0, -stripBefore) + link
      lastIndex = consumeEnd
      continue
    }

    result += text.slice(lastIndex, consumeStart) + link
    lastIndex = consumeEnd
  }

  result += text.slice(lastIndex)
  return result
}
