import type { NewSearchData } from "~/domain/search/types"

const buildFlaggedAnnotationsSql = (codeId: string): string =>
  `SELECT file, id, text, vote_review FROM annotations WHERE code = '${codeId}' AND vote_review IS NOT NULL AND vote_review != ''`

export const buildFlaggedSearch = (codeId: string, title: string): NewSearchData => ({
  title: `${title} (flagged)`,
  description: `Annotations flagged for review: ${title}`,
  sql: buildFlaggedAnnotationsSql(codeId),
})

const escapeSqlString = (s: string): string => s.replace(/'/g, "''")

const buildCandidateFilename = (codeId: string): string => `${codeId}.generated.hidden.md`

export const buildCandidateSearch = (codeId: string): NewSearchData => ({
  title: `${codeId} (candidates)`,
  description: `File-similarity search for passages matching code: ${codeId}`,
  sql: `SELECT f.file, f.text, EMBEDDINGS_FROM_FILE('${escapeSqlString(buildCandidateFilename(codeId))}') FROM files f`,
})
