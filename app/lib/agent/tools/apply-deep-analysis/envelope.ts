export interface Envelope {
  id: string
  code: string
  file: string
  fileCharStart: number
  fileCharEnd: number
  haloSentences: string[]
  markedStart: number
  markedEnd: number
  markedText: string
  score?: number
  findVotes: boolean[]
  reason?: string
  review?: string
}

export const isContestedEnvelope = (e: Envelope): boolean => e.review !== undefined

export const envelopeText = (e: Envelope): string => e.markedText

export const collectCodeIds = (envelopes: readonly Envelope[]): Set<string> => {
  const out = new Set<string>()
  for (const e of envelopes) out.add(e.code)
  return out
}
