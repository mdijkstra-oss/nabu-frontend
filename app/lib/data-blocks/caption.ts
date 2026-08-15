export interface CaptionEntry {
  readonly captionType: string
  readonly pos: number
}

export const findCaptionIndex = (
  entries: readonly CaptionEntry[],
  pos: number,
  captionType: string
): number => {
  let index = 0
  for (const entry of entries) {
    if (entry.captionType !== captionType) continue
    index++
    if (entry.pos === pos) return index
  }
  return 0
}

export const formatCaption = (
  captionType: string | undefined,
  captionIndex: number,
  label: string
): string =>
  !captionType || captionIndex === 0 ? label : `${captionType} ${captionIndex}: ${label}`
