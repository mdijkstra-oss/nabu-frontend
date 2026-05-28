import type { NewSearchData } from "~/domain/search/types"

const buildFlaggedAnnotationsSql = (codeId: string): string =>
  `SELECT file, id, text, vote_review FROM annotations WHERE code = '${codeId}' AND vote_review IS NOT NULL AND vote_review != ''`

export const buildFlaggedSearch = (codeId: string, title: string): NewSearchData => ({
  title: `${title} (flagged)`,
  description: `Annotations flagged for review: ${title}`,
  sql: buildFlaggedAnnotationsSql(codeId),
})

export const buildCandidatePlaceholder = (title: string): NewSearchData => ({
  title: `${title} (candidates)`,
  description: `Semantic search for passages matching: ${title}`,
  sql: "",
})

const escapeSqlString = (s: string): string => s.replace(/'/g, "''")

export const buildCandidateSql = (intent: string): string =>
  `SELECT f.file, f.text, SEMANTIC('${escapeSqlString(intent)}') FROM files f`
