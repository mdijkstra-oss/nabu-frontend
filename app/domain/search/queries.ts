export const buildFlaggedAnnotationsSql = (codeId: string): string =>
  `SELECT file, id, text, vote_review FROM annotations WHERE code = '${codeId}' AND vote_review IS NOT NULL AND vote_review != ''`
