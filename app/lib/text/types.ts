export interface Segment {
  text: string
  start: number
  end: number
}

export type Splitter = (text: string) => Segment[]

export interface ChunkConfig {
  target: number
  min: number
  maxSegment?: number
  breakBefore?: (segment: Segment) => boolean
  sizeOf?: (segment: Segment) => number
}

export interface TextChunk {
  text: string
  start: number
  end: number
}
