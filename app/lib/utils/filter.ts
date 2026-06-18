const collapseSeparators = (text: string): string => text.replace(/[-_./\\]+/g, " ")

const normalize = (text: string): string => collapseSeparators(text.toLowerCase().trim())

export const matchesFilter = (query: string, text: string): boolean => {
  const normalizedQuery = normalize(query)
  if (normalizedQuery === "") return true
  return normalize(text).includes(normalizedQuery)
}

export const matchesAny = (query: string, texts: string[]): boolean =>
  texts.some((text) => matchesFilter(query, text))

export const matchesAllWords = (query: string, texts: string[]): boolean => {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const combined = texts.map(normalize).join(" ")
  return words.every((word) => combined.includes(word))
}

// How many distinct query words appear in the texts (order-independent). 0 = no match; higher =
// stronger. Use to rank "most matches win".
export const scoreWords = (query: string, texts: string[]): number => {
  const words = [...new Set(normalize(query).split(/\s+/).filter(Boolean))]
  if (words.length === 0) return 0
  const combined = texts.map(normalize).join(" ")
  return words.reduce((score, word) => (combined.includes(word) ? score + 1 : score), 0)
}
