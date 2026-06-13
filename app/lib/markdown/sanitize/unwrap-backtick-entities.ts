import { getEntityPrefixes } from "~/lib/data-blocks/registry"
import { SLUG_PATTERN } from "~/lib/markdown/linkify/tags"

const BACKTICK_PATTERN = /```[\s\S]*?```|\[[^\]]*\]\([^)]+\)|`([^`]+)`/g

const buildEntityShapePattern = (prefixes: string[]): RegExp => {
  const prefixAlt = prefixes.join("|")
  return new RegExp(
    `^(?:#${SLUG_PATTERN.source}|(?:${prefixAlt})-[a-z0-9]{8}|[\\w][\\w-]*\\.md|\\[[^\\]]*\\]\\([^)]+\\))$`,
    "i"
  )
}

const isEntityShape = (inner: string, pattern: RegExp): boolean => pattern.test(inner)

export const unwrapBacktickEntities = (text: string): string => {
  if (!text.includes("`")) return text
  const prefixes = getEntityPrefixes()
  if (prefixes.length === 0) return text
  const shape = buildEntityShapePattern(prefixes)
  const pattern = new RegExp(BACKTICK_PATTERN.source, "g")
  let result = ""
  let lastIndex = 0

  while (true) {
    pattern.lastIndex = lastIndex
    const match = pattern.exec(text)
    if (!match) break

    if (match[1] === undefined) {
      result += text.slice(lastIndex, match.index + match[0].length)
      lastIndex = match.index + match[0].length
      continue
    }

    const inner = match[1].trim()
    if (!isEntityShape(inner, shape)) {
      result += text.slice(lastIndex, match.index + match[0].length)
      lastIndex = match.index + match[0].length
      continue
    }

    result += text.slice(lastIndex, match.index) + inner
    lastIndex = match.index + match[0].length
  }

  result += text.slice(lastIndex)
  return result
}
