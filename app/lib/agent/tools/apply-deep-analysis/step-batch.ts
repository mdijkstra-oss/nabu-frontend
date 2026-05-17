import type { Annotation } from "./types"

export const BATCH_MAX_SIZE = 20

interface CodeGroup {
  code: string
  annotations: Annotation[]
}

const groupByCode = (annotations: Annotation[]): CodeGroup[] => {
  const map = new Map<string, Annotation[]>()
  for (const a of annotations) {
    const group = map.get(a.code) ?? []
    group.push(a)
    map.set(a.code, group)
  }
  return [...map.entries()]
    .map(([code, anns]) => ({ code, annotations: anns }))
    .sort((a, b) => b.annotations.length - a.annotations.length)
}

export const batchByCode = (annotations: Annotation[], maxSize: number): Annotation[][] => {
  const groups = groupByCode(annotations)
  const batches: Annotation[][] = []
  const remaining = [...groups]

  while (remaining.length > 0) {
    const largest = remaining.shift()
    if (!largest) break
    if (largest.annotations.length >= maxSize) {
      batches.push(largest.annotations.slice(0, maxSize))
      const rest = largest.annotations.slice(maxSize)
      if (rest.length > 0) {
        remaining.push({ code: largest.code, annotations: rest })
        remaining.sort((a, b) => b.annotations.length - a.annotations.length)
      }
    } else {
      const bin = [...largest.annotations]
      while (bin.length < maxSize && remaining.length > 0) {
        const space = maxSize - bin.length
        const next = remaining.shift()
        if (!next) break
        if (next.annotations.length <= space) {
          bin.push(...next.annotations)
        } else {
          bin.push(...next.annotations.slice(0, space))
          remaining.unshift({ code: next.code, annotations: next.annotations.slice(space) })
        }
      }
      batches.push(bin)
    }
  }

  return batches
}
