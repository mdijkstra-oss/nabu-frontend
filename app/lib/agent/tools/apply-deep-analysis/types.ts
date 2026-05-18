export interface Annotation {
  start: number
  end: number
  code: string
  findVotes: boolean[]
  review?: string
  reason: string
}

export interface StepError {
  step: string
  message: string
}
