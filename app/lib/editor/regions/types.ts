export interface RenderableRegion {
  index: number
  kind: string
  kindOrder: number
  label: string
  colour: string
  icon: string
  quote: string
  hitSentence: number
  startSentence: number
  endSentence: number
}

export interface RegionsInput {
  regions: RenderableRegion[]
  sentences: string[]
  hovered: number | null
}

export type RegionsMessage =
  | { type: "regions"; regions: RenderableRegion[]; sentences: string[] }
  | { type: "hover"; index: number | null }
