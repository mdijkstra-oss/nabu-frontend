import type { BlockTypeConfig, ActorPathConfig, IdPathConfig, IdRefExpansion } from "./definition"
import { toBlockSchema, type BlockSchemaDefinition } from "./json-schema"
import { getByPath } from "./json"
import { stripBlocksByLanguage } from "./parse"
import { jsonAttributes } from "~/domain/data-blocks/attributes/definition"
import { jsonSettings } from "~/domain/data-blocks/settings/definition"
import { jsonCallout } from "~/domain/data-blocks/callout/definition"
import { jsonAnnotations } from "~/domain/data-blocks/annotations/definition"
import { jsonChart } from "~/domain/data-blocks/chart/definition"
import { jsonUx } from "~/domain/data-blocks/ux/definition"
import { jsonEmbeddings } from "~/domain/data-blocks/embeddings/definition"
import { jsonRegions } from "~/domain/data-blocks/regions/definition"
import { jsonTable } from "~/domain/data-blocks/table/definition"
import { withInferredMeta } from "~/lib/regions/decorate/extend-config"

type AnyBlockConfig = BlockTypeConfig

const declared: Record<string, AnyBlockConfig> = {
  "json-attributes": jsonAttributes as AnyBlockConfig,
  "json-settings": jsonSettings as AnyBlockConfig,
  "json-callout": jsonCallout as AnyBlockConfig,
  "json-annotations": jsonAnnotations as AnyBlockConfig,
  "json-chart": jsonChart as AnyBlockConfig,
  "json-ux": jsonUx as AnyBlockConfig,
  "json-embeddings": jsonEmbeddings as AnyBlockConfig,
  "json-regions": jsonRegions as AnyBlockConfig,
  "json-table": jsonTable as AnyBlockConfig,
}

const blockTypes: Record<string, AnyBlockConfig> = Object.fromEntries(
  Object.entries(declared).map(([language, config]) => [language, withInferredMeta(config)])
)

export const BLOCK_LANGUAGES = Object.keys(blockTypes) as [string, ...string[]]

export const getBlockConfig = (language: string): AnyBlockConfig | undefined => blockTypes[language]

export const isKnownBlockType = (language: string): boolean => language in blockTypes

export const isHiddenRenderer = (language: string): boolean =>
  blockTypes[language]?.renderer === "hidden"

export const isChartRenderer = (language: string): boolean =>
  blockTypes[language]?.renderer === "chart"

export const isSingleton = (language: string): boolean => blockTypes[language]?.singleton ?? false

export const getSingletonLanguages = (): string[] =>
  BLOCK_LANGUAGES.filter((lang) => blockTypes[lang]?.singleton)

export const stripSingletonBlocks = (raw: string): string =>
  getSingletonLanguages().reduce((text, lang) => stripBlocksByLanguage(text, lang), raw)

export const getLabelKey = (language: string): string | undefined => blockTypes[language]?.labelKey

export const getCaptionType = (language: string): string | undefined =>
  blockTypes[language]?.captionType

export const resolveBlockLabel = (
  language: string,
  parsed: Record<string, unknown>
): string | null => {
  const labelKey = blockTypes[language]?.labelKey
  if (!labelKey) return null
  const value = getByPath(parsed, labelKey)
  return typeof value === "string" ? value : null
}

export const resolveBlockId = (
  language: string,
  parsed: Record<string, unknown>
): string | null => {
  const rootIdPath = (blockTypes[language]?.idPaths ?? []).find((p) => !p.path.includes("."))
  if (!rootIdPath) return null
  const value = getByPath(parsed, rootIdPath.path)
  return typeof value === "string" ? value : null
}

export const getImmutableFields = (language: string): Record<string, string> =>
  blockTypes[language]?.immutable ?? {}

export const getIdPaths = (language: string): IdPathConfig[] => blockTypes[language]?.idPaths ?? []

export const getActorPaths = (language: string): ActorPathConfig[] =>
  blockTypes[language]?.actorPaths ?? []

export const getFuzzyFields = (language: string): string[] =>
  blockTypes[language]?.fuzzyFields ?? []

export const getNormalizeAsFileFields = (language: string): string[] =>
  blockTypes[language]?.normalizeAsFile ?? []

export const getAllowedFiles = (language: string): string[] | undefined =>
  blockTypes[language]?.allowedFiles

export const getExpandIdRefs = (language: string): IdRefExpansion[] =>
  blockTypes[language]?.expandIdRefs ?? []

export const findBlockConfigByPrefix = (
  prefix: string
): { language: string; config: AnyBlockConfig } | undefined => {
  const entry = Object.entries(blockTypes).find(([, config]) =>
    config.idPaths?.some((p) => p.prefix === prefix)
  )
  return entry ? { language: entry[0], config: entry[1] } : undefined
}

export const getEntityPrefixes = (): string[] => [
  ...new Set(Object.values(blockTypes).flatMap((c) => c.idPaths?.map((p) => p.prefix) ?? [])),
]

export const getProjectedConfigs = (): [string, AnyBlockConfig][] =>
  Object.entries(blockTypes).filter(([, config]) => config.projected)

export const getPerBlockProjectedConfigs = (): [string, AnyBlockConfig][] =>
  Object.entries(blockTypes).filter(([, config]) => config.projectedPerBlock)

export const getBlockSchemaDefinitions = (): BlockSchemaDefinition[] =>
  Object.entries(blockTypes).map(([language, config]) => ({
    language,
    jsonSchema: toBlockSchema(config),
    singleton: config.singleton,
    immutable: Object.keys(config.immutable),
    constraints: config.constraints,
  }))

export const getSpanField = (language: string): string | undefined =>
  blockTypes[language]?.spanField
