import { getEntityPrefixes } from "~/lib/data-blocks/registry"
import { ENTITY_ID_SUFFIX } from "~/lib/utils/entity-id"

const HIDDEN_SUFFIX = /\.generated\.[hH]idden\.md/g

const buildQuotedEntityPattern = (): RegExp => {
  const alt = getEntityPrefixes().join("|")
  return new RegExp(
    `(["'\`])((?:${alt})-${ENTITY_ID_SUFFIX}|[\\w][\\w-]*\\.md|#[a-z0-9]+(?:-[a-z0-9]+)*)\\1`,
    "gi"
  )
}

export const stripHiddenSuffix = (text: string): string => text.replace(HIDDEN_SUFFIX, "")

export const stripEntityQuotes = (text: string): string =>
  text.replace(buildQuotedEntityPattern(), "$2")
