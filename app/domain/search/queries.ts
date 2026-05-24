import type { NewSearchData } from "~/domain/search/types"

export const buildFlaggedAnnotationsSql = (codeId: string): string =>
  `SELECT file, id, text, vote_review FROM annotations WHERE code = '${codeId}' AND vote_review IS NOT NULL AND vote_review != ''`

export const buildFlaggedSearch = (codeId: string, title: string): NewSearchData => ({
  title: `${title} (flagged)`,
  description: `Annotations flagged for review: ${title}`,
  sql: buildFlaggedAnnotationsSql(codeId),
  meta: { toolbar: "code-refinement", codeId },
})
