import type { Result } from "~/lib/fp/result"
import { ok, err } from "~/lib/fp/result"
import { rejectSqlPatterns } from "~/lib/sql/reject"
import { LIMIT_RE, extractLimit, stripPaging } from "./paging"

export interface SemanticToken {
  text: string
  start: number
  end: number
}

export interface HydeQuery {
  text: string
  language: string
  cosineVector: number[]
}

export interface HybridSearchPlan {
  intent: string
  baseSql: string
  hydes: HydeQuery[]
  limit: number | undefined
}

const FILES_TABLE_RE = /\bFROM\s+files\b/i

export const sqlQueriesFilesTable = (sql: string): boolean => FILES_TABLE_RE.test(sql)

const SQL_STRING_BODY = "[^']*(?:''[^']*)*"
const SEMANTIC_PATTERN = new RegExp(`SEMANTIC\\('(${SQL_STRING_BODY})'\\)`, "g")
const FILE_EMBEDDING_PATTERN = new RegExp(`EMBEDDINGS_FROM_FILE\\('(${SQL_STRING_BODY})'\\)`, "g")
const SCORE_COLUMN = "_semantic_score"

export const SEMANTIC_ABSENCE_HINT =
  "\n-----\nIf SEMANTIC results are off-topic, the corpus does not contain what was asked for. Do not retry with grep or ILIKE. Absence is data."

const OPERATOR_AFTER_SEMANTIC = new RegExp(
  `SEMANTIC\\('${SQL_STRING_BODY}'\\)\\s*(>|<|>=|<=|=|!=|<>)`
)
const AS_AFTER_SEMANTIC = new RegExp(`SEMANTIC\\('${SQL_STRING_BODY}'\\)\\s*AS\\b`, "i")
const SEMANTIC_IN_ORDER_BY = /ORDER\s+BY\s[\s\S]*?SEMANTIC\s*\(/i

const ORDER_BY_RE = /\bORDER\s+BY\s+/i
const ORDER_BY_TAIL_RE = /\s*ORDER\s+BY\s+[\s\S]*$/i

const formatVector = (vector: number[]): string => `[${vector.join(",")}]`

const unescapeSqlString = (s: string): string => s.replace(/''/g, "'")

export const extractSemanticTokens = (sql: string): SemanticToken[] => {
  const tokens: SemanticToken[] = []
  let match: RegExpExecArray | null
  while ((match = SEMANTIC_PATTERN.exec(sql)) !== null) {
    tokens.push({
      text: unescapeSqlString(match[1]),
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  SEMANTIC_PATTERN.lastIndex = 0
  return tokens
}

export const hasSemanticTokens = (sql: string): boolean => {
  const result = SEMANTIC_PATTERN.test(sql)
  SEMANTIC_PATTERN.lastIndex = 0
  return result
}

export const extractFileEmbeddingTokens = (sql: string): SemanticToken[] => {
  const tokens: SemanticToken[] = []
  let match: RegExpExecArray | null
  while ((match = FILE_EMBEDDING_PATTERN.exec(sql)) !== null) {
    tokens.push({
      text: unescapeSqlString(match[1]),
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  FILE_EMBEDDING_PATTERN.lastIndex = 0
  return tokens
}

export const hasFileEmbeddingTokens = (sql: string): boolean => {
  const result = FILE_EMBEDDING_PATTERN.test(sql)
  FILE_EMBEDDING_PATTERN.lastIndex = 0
  return result
}

const validateFileEmbeddingSql = (sql: string, tokens: SemanticToken[]): string[] => {
  const errors: string[] = []
  if (tokens.length > 1) errors.push("Multiple EMBEDDINGS_FROM_FILE() calls. Use one per query.")
  if (hasSemanticTokens(sql))
    errors.push("Cannot combine SEMANTIC() and EMBEDDINGS_FROM_FILE() in the same query.")
  return errors
}

export const validateSemanticSql = (sql: string, tokens: SemanticToken[]): string[] => {
  const errors: string[] = []
  if (tokens.length > 1)
    errors.push(
      "Multiple SEMANTIC() calls. Use one per query — the system ranks by similarity automatically."
    )
  if (OPERATOR_AFTER_SEMANTIC.test(sql))
    errors.push(
      "SEMANTIC() followed by comparison operator. Don't threshold similarity scores — the system ranks results automatically. Just write SEMANTIC('text') in the SELECT list."
    )
  if (AS_AFTER_SEMANTIC.test(sql))
    errors.push(
      "SEMANTIC() followed by AS alias. The system aliases it automatically. Just write SEMANTIC('text')."
    )
  if (SEMANTIC_IN_ORDER_BY.test(sql))
    errors.push(
      "SEMANTIC() inside ORDER BY. The system adds ORDER BY automatically. Only specify non-semantic ordering columns."
    )
  return errors
}

const MAX_ILIKE_CLAUSES = 3
const ILIKE_PATTERN = /\bILIKE\b/gi

export const countIlikeClauses = (sql: string): number => (sql.match(ILIKE_PATTERN) ?? []).length

export const validateSql = (sql: string): Result<void, string> => {
  const errors: string[] = [...rejectSqlPatterns(sql)]

  if (countIlikeClauses(sql) > MAX_ILIKE_CLAUSES)
    errors.push(
      "Too many ILIKE clauses. Use SEMANTIC('text') for meaning-based matching instead of listing keyword variants."
    )

  if (hasSemanticTokens(sql)) {
    const tokens = extractSemanticTokens(sql)
    errors.push(...validateSemanticSql(sql, tokens))
  }

  if (hasFileEmbeddingTokens(sql)) {
    const tokens = extractFileEmbeddingTokens(sql)
    errors.push(...validateFileEmbeddingSql(sql, tokens))
  }

  if (errors.length === 0) return ok(undefined)
  return err(errors.join("\n"))
}

const COSINE_IN_ERROR =
  /list_cosine_similarity\(embedding[^)\n]*(?:\)(?:\s*AS\s*_semantic_score)?)?/g

export const sanitizeSemanticError = (error: string): string =>
  error.replace(COSINE_IN_ERROR, "SEMANTIC(...)")

export const stripSemanticToken = (sql: string, token: SemanticToken): string => {
  const before = sql.slice(0, token.start)
  const after = sql.slice(token.end)
  const hasCommaBefore = /,\s*$/.test(before)
  const hasCommaAfter = /^\s*,/.test(after)
  if (hasCommaBefore && hasCommaAfter) {
    return before.replace(/,\s*$/, "") + after
  }
  if (hasCommaBefore) {
    return before.replace(/,\s*$/, "") + after
  }
  if (hasCommaAfter) {
    return before + after.replace(/^\s*,/, "")
  }
  return before + after
}

const stripOrderByTail = (sql: string): string => sql.replace(ORDER_BY_TAIL_RE, "")

const FROM_RE = /\bFROM\b/i

const injectSelectColumn = (sql: string, column: string): string => {
  const match = FROM_RE.exec(sql)
  if (!match) return `${sql}, ${column}`
  const beforeFrom = sql.slice(0, match.index)
  const fromOnward = sql.slice(match.index)
  return `${beforeFrom.trimEnd()}, ${column} ${fromOnward}`
}

const WHERE_RE = /\bWHERE\b/i

const escapeSqlString = (value: string): string => value.replace(/'/g, "''")

const injectLanguageFilter = (sql: string, language: string): string => {
  const escaped = escapeSqlString(language)
  if (WHERE_RE.test(sql)) return sql.replace(WHERE_RE, `WHERE language = '${escaped}' AND`)
  const fromMatch = FROM_RE.exec(sql)
  if (!fromMatch) return `${sql} WHERE language = '${escaped}'`
  const afterFrom = sql.slice(fromMatch.index + fromMatch[0].length)
  const tableEnd = afterFrom.search(/\s+(WHERE|ORDER|LIMIT|GROUP|HAVING)/i)
  const insertAt =
    fromMatch.index + fromMatch[0].length + (tableEnd === -1 ? afterFrom.length : tableEnd)
  return `${sql.slice(0, insertAt)} WHERE language = '${escaped}'${sql.slice(insertAt)}`
}

const buildCosineBase = (baseSql: string, hyde: HydeQuery): string => {
  const vec = formatVector(hyde.cosineVector)
  const core = stripOrderByTail(stripPaging(baseSql))
  const withLanguage = injectLanguageFilter(core, hyde.language)
  return injectSelectColumn(
    withLanguage,
    `list_cosine_similarity(embedding, ${vec}) AS ${SCORE_COLUMN}`
  )
}

const COSINE_QUERY_LIMIT = 200

export const buildCosineQuery = (baseSql: string, hyde: HydeQuery): string =>
  `${buildCosineBase(baseSql, hyde)} ORDER BY ${SCORE_COLUMN} DESC LIMIT ${COSINE_QUERY_LIMIT}`

export const buildHybridPlan = (
  sql: string,
  token: SemanticToken,
  hydes: HydeQuery[]
): HybridSearchPlan => {
  const baseSql = stripSemanticToken(sql, token)
  const limit = extractLimit(sql)
  return { intent: token.text, baseSql, hydes, limit }
}

const aliasTokens = (sql: string, tokens: SemanticToken[], wrapper: string): string => {
  let result = ""
  let cursor = 0
  for (const token of tokens) {
    result += sql.slice(cursor, token.start)
    result += `${wrapper}('${escapeSqlString(token.text)}') AS ${SCORE_COLUMN}`
    cursor = token.end
  }
  result += sql.slice(cursor)
  return result
}

export const formatDebugSql = (sql: string): string => {
  if (hasSemanticTokens(sql)) {
    const tokens = extractSemanticTokens(sql)
    return normalizeSemanticSql(aliasTokens(sql, tokens, "SEMANTIC"))
  }
  if (hasFileEmbeddingTokens(sql)) {
    const tokens = extractFileEmbeddingTokens(sql)
    return normalizeSemanticSql(aliasTokens(sql, tokens, "EMBEDDINGS_FROM_FILE"))
  }
  return sql
}

export const normalizeSemanticSql = (sql: string): string => {
  let result = sql.trimEnd()
  const hasOrderBy = ORDER_BY_RE.test(result)
  const hasLimit = LIMIT_RE.test(result)

  if (hasOrderBy) {
    result = result.replace(ORDER_BY_RE, (match) => `${match}${SCORE_COLUMN} DESC, `)
  } else if (hasLimit) {
    result = result.replace(LIMIT_RE, (match) => `ORDER BY ${SCORE_COLUMN} DESC ${match}`)
  } else {
    result += ` ORDER BY ${SCORE_COLUMN} DESC`
  }

  return result
}
