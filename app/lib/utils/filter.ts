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

export const matchesWordsInOrder = (query: string, texts: string[]): boolean => {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const combined = texts.map(normalize).join(" ")
  let pos = 0
  for (const word of words) {
    const idx = combined.indexOf(word, pos)
    if (idx === -1) return false
    pos = idx + word.length
  }
  return true
}
