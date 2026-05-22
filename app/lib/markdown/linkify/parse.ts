import { parseSpotlightText } from "~/lib/editor/spotlight/parse"
import type { EntityKind, EntityRef } from "./types"
import { getEntityPrefixes } from "~/lib/data-blocks/registry"

const FILE_PROTOCOL = "file://"

const findPrefixedEntity = (path: string): EntityRef | null => {
  for (const prefix of getEntityPrefixes()) {
    if (path.startsWith(prefix + "-")) {
      return { kind: prefix as EntityKind, id: path } as EntityRef
    }
  }
  return null
}

const parseTextRef = (path: string): EntityRef => {
  const slashIndex = path.indexOf("/")
  if (slashIndex === -1) return { kind: "text", documentId: path, spotlight: null }
  const documentId = path.slice(0, slashIndex)
  const textPart = decodeURIComponent(path.slice(slashIndex + 1).replace(/\+/g, " "))
  return { kind: "text", documentId, spotlight: parseSpotlightText(textPart) }
}

export const parseEntityLink = (href: string): EntityRef | null => {
  if (!href.startsWith(FILE_PROTOCOL)) return null
  const path = href.slice(FILE_PROTOCOL.length)
  if (!path) return null
  const entity = findPrefixedEntity(path)
  if (entity) return entity
  return parseTextRef(path)
}
