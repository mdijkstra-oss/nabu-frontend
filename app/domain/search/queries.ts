import type { NewSearchData } from "~/domain/search/types"
import { kindTitle } from "~/lib/regions/kinds/title-tags"

const buildFlaggedAnnotationsSql = (codeId: string): string =>
  `SELECT file, id, text, vote_review FROM annotations WHERE code = '${codeId}' AND vote_review IS NOT NULL AND vote_review != ''`

export const buildFlaggedSearch = (codeId: string, title: string): NewSearchData => ({
  title: `${title} (flagged)`,
  description: `Annotations flagged for review: ${title}`,
  sql: buildFlaggedAnnotationsSql(codeId),
})

export const escapeSqlString = (s: string): string => s.replace(/'/g, "''")

export interface RegionSearchTarget {
  kind: string
  value: string
  label: string
}

export const buildRegionSearch = ({ kind, value, label }: RegionSearchTarget): NewSearchData => ({
  title: kindTitle(kind, label),
  description: `Passages where ${kind} is ${label}`,
  sql: `SELECT file, quote AS text, start_sentence, end_sentence FROM regions WHERE kind = '${escapeSqlString(kind)}' AND parsed_value = '${escapeSqlString(value)}' ORDER BY file, start_sentence`,
})

const buildCandidateFilename = (codeId: string): string => `${codeId}.generated.hidden.md`

export const buildCandidateSearch = (codeId: string): NewSearchData => ({
  title: `${codeId} (candidates)`,
  description: `File-similarity search for passages matching code: ${codeId}`,
  sql: `SELECT f.file, f.text, EMBEDDINGS_FROM_FILE('${escapeSqlString(buildCandidateFilename(codeId))}') FROM files f`,
})

export const buildFileCandidateSearch = (codeId: string, file: string): NewSearchData => ({
  title: `${codeId} (candidates in ${file})`,
  description: `File-similarity search for passages matching code: ${codeId} — limited to ${file}`,
  sql: `SELECT f.file, f.text, EMBEDDINGS_FROM_FILE('${escapeSqlString(buildCandidateFilename(codeId))}') FROM files f WHERE f.file = '${escapeSqlString(file)}'`,
})
