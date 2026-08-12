// A model reading "sentence 1" is doing what models do, so the payload numbers from 1
// while every index around it is a 0-based array position.
export const toModelNumber = (sentenceIndex: number): number => sentenceIndex + 1

export const toSentenceIndex = (modelNumber: number): number => modelNumber - 1

export const renderNumberedSentences = (sentences: string[], firstSentence: number): string =>
  sentences.map((text, i) => `[${toModelNumber(firstSentence + i)}] ${text}`).join("\n")
