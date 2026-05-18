export interface ResolvedAnnotation {
  id?: string
  index: number
  from: number
  to: number
  color: string
  review?: boolean
}

export interface OverlapSegment {
  from: number
  to: number
  colors: string[]
}
