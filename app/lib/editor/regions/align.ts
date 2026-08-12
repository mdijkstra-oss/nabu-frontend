import { tokenizeWords } from "~/lib/text/find"

const signatureOf = (sentence: string): string => tokenizeWords(sentence).join(" ")

const indexBySignature = (sentences: readonly string[]): Map<string, number[]> => {
  const rows = new Map<string, number[]>()
  sentences.forEach((sentence, row) => {
    const signature = signatureOf(sentence)
    if (!signature) return
    const existing = rows.get(signature)
    if (existing) existing.push(row)
    else rows.set(signature, [row])
  })
  return rows
}

export const alignSentences = (
  source: readonly string[],
  editor: readonly string[]
): (number | null)[] => {
  const rowsBySignature = indexBySignature(editor)
  let cursor = 0
  return source.map((sentence) => {
    const rows = rowsBySignature.get(signatureOf(sentence))
    const row = rows?.find((candidate) => candidate >= cursor)
    if (row === undefined) return null
    cursor = row + 1
    return row
  })
}
