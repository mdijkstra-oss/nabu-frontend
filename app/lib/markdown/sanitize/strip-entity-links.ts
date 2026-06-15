import { getEntityPrefixes } from "~/lib/data-blocks/registry"
import { ENTITY_ID_SUFFIX } from "~/lib/utils/entity-id"

const buildEntityIdInLinkPattern = (): RegExp => {
  const prefixAlt = getEntityPrefixes().join("|")
  return new RegExp(`(?:${prefixAlt})-${ENTITY_ID_SUFFIX}|[\\w][\\w-]*\\.md`, "gi")
}

const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/g

const isOnlyEntityId = (text: string, entityPattern: RegExp): boolean => {
  entityPattern.lastIndex = 0
  const match = entityPattern.exec(text.trim())
  return match !== null && match[0] === text.trim()
}

const stripEntityIdsFromText = (text: string, entityPattern: RegExp): string => {
  entityPattern.lastIndex = 0
  return text
    .replace(entityPattern, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

export const stripEntityLinks = (text: string): string =>
  text.replace(MARKDOWN_LINK, (full, linkText: string, url: string) => {
    const entityPattern = buildEntityIdInLinkPattern()

    if (isOnlyEntityId(linkText, entityPattern)) return linkText.trim()

    const stripped = stripEntityIdsFromText(linkText, entityPattern)
    if (stripped === linkText) return full
    return `[${stripped}](${url})`
  })
