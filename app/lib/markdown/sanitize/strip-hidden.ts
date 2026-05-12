import { getEntityPrefixes } from "~/lib/data-blocks/registry"

const HIDDEN_SUFFIX = /\.generated\.[hH]idden\.md/g

const buildQuotedEntityPattern = (): RegExp => {
  const alt = getEntityPrefixes().join("|")
  return new RegExp(
    `(["'\`])((?:${alt})-[a-z0-9]{8}|[\\w][\\w-]*\\.md|#[a-z0-9]+(?:-[a-z0-9]+)*)\\1`,
    "gi"
  )
}

export const stripHiddenSuffix = (text: string): string => text.replace(HIDDEN_SUFFIX, "")

export const stripEntityQuotes = (text: string): string =>
  text.replace(buildQuotedEntityPattern(), "$2")
