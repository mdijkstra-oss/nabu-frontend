import { z } from "zod"
import type { ProjectionConfig } from "~/lib/db/projection"
import type { JsonSchema } from "~/lib/db/types"
import type { BlockTypeConfig } from "~/lib/data-blocks/definition"
import { getProjectedConfigs } from "~/lib/data-blocks/registry"
import { getBlock, getBlocks } from "~/lib/data-blocks/query"
import { EmbeddingRowSchema } from "~/domain/embeddings/schema"
import { fastParseBlockContents } from "~/lib/embeddings/companion"

const parseCompanionBlock = (content: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!EmbeddingRowSchema.safeParse(parsed).success) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

const parseCompanionBlocksForDb = (raw: string): Record<string, unknown>[] =>
  fastParseBlockContents(raw)
    .map(parseCompanionBlock)
    .filter((b): b is Record<string, unknown> => b !== null)

const stripLanguagePrefix = (language: string): string => language.replace("json-", "")

const buildBlockParser = (
  language: string,
  schema: z.ZodType,
  singleton: boolean,
  rowPath?: string
) => {
  const parseBlocks = (raw: string): unknown[] =>
    singleton ? [getBlock(raw, language, schema)].filter(Boolean) : getBlocks(raw, language, schema)

  if (!rowPath) return parseBlocks

  return (raw: string): unknown[] =>
    parseBlocks(raw).flatMap((block) => {
      const items = (block as Record<string, unknown>)[rowPath]
      return Array.isArray(items) ? items : []
    })
}

const getRowSchema = (config: BlockTypeConfig): z.ZodType => {
  const schema = config.schema()
  if (!config.rowPath) return schema
  const arraySchema = (schema as z.ZodObject<Record<string, z.ZodType>>).shape[config.rowPath]
  return (arraySchema as z.ZodArray<z.ZodType>).element
}

const toProjectionConfig = ([language, config]: [string, BlockTypeConfig]): ProjectionConfig => ({
  language,
  tableName: config.tableName ?? stripLanguagePrefix(language),
  schema: getRowSchema(config),
  singleton: config.singleton,
  blockParser: buildBlockParser(language, config.schema(), config.singleton, config.rowPath),
  allowedFiles: config.allowedFiles,
  hiddenColumns: config.hiddenColumns,
})

const embeddingsProjection: ProjectionConfig = {
  language: "json-embeddings",
  tableName: "files",
  schema: EmbeddingRowSchema,
  singleton: false,
  blockParser: parseCompanionBlocksForDb,
  fileMapper: (f) => f.replace(/\.embeddings\.hidden\.md$/, ".md"),
  hiddenColumns: ["hash", "embedding"],
}

let _projections: ProjectionConfig[] | null = null

export const getProjections = (): ProjectionConfig[] => {
  if (!_projections) {
    _projections = [...getProjectedConfigs().map(toProjectionConfig), embeddingsProjection]
  }
  return _projections
}

export const toJsonSchema = (config: ProjectionConfig): JsonSchema =>
  z.toJSONSchema(config.schema, { io: "input" }) as JsonSchema
