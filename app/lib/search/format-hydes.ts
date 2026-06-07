import type { HydeQuery, KeywordsQuery } from "./semantic"

const groupByLanguage = (hydes: HydeQuery[]): Map<string, HydeQuery[]> => {
  const map = new Map<string, HydeQuery[]>()
  for (const hyde of hydes) {
    const existing = map.get(hyde.language) ?? []
    existing.push(hyde)
    map.set(hyde.language, existing)
  }
  return map
}

const formatLanguageHeader = (language: string): string => `━━━ ${language.toUpperCase()} ━━━`

const formatLanguageBlock = (
  language: string,
  hydes: HydeQuery[],
  keywords: KeywordsQuery | undefined
): string => {
  const lines = hydes.map((h, i) => `  ${i + 1}. ${h.text}`).join("\n")
  const keywordsLine = keywords ? `\n  keywords: ${keywords.text}` : ""
  return `${formatLanguageHeader(language)}\n${lines}${keywordsLine}`
}

export const formatHydeDebug = (hydes: HydeQuery[], keywords: KeywordsQuery[] = []): string => {
  const byLanguage = groupByLanguage(hydes)
  const keywordsByLanguage = new Map(keywords.map((k) => [k.language, k]))
  return [...byLanguage.entries()]
    .map(([language, langHydes]) =>
      formatLanguageBlock(language, langHydes, keywordsByLanguage.get(language))
    )
    .join("\n\n")
}
