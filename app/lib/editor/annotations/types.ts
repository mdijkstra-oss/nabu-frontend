export interface ResolvedAnnotation {
  id?: string
  index: number
  from: number
  to: number
  color: string
  locked?: boolean
  review?: boolean
  dimmed?: boolean
}

export interface OverlapSegment {
  from: number
  to: number
  colors: string[]
  dimmed?: boolean
}
