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
