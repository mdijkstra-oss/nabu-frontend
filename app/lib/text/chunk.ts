import type { Segment, ChunkConfig, TextChunk } from "./types"

const defaultSizeOf = (s: Segment): number => s.text.length

interface Buffer {
  segments: Segment[]
  size: number
  start: number
  end: number
}

const emptyBuffer = (start: number): Buffer => ({
  segments: [],
  size: 0,
  start,
  end: start,
})

const toChunk = (buf: Buffer): TextChunk => ({
  text: buf.segments.map((s) => s.text).join(""),
  start: buf.start,
  end: buf.end,
})

const appendSegment = (buf: Buffer, seg: Segment, size: number): Buffer => ({
  segments: [...buf.segments, seg],
  size: buf.size + size,
  start: buf.segments.length === 0 ? seg.start : buf.start,
  end: seg.end,
})

const forceSplitSegment = (seg: Segment, target: number): Segment[] => {
  const parts: Segment[] = []
  let offset = 0
  const text = seg.text

  while (offset < text.length) {
    const remaining = text.length - offset
    if (remaining <= target) {
      parts.push({ text: text.slice(offset), start: seg.start + offset, end: seg.end })
      break
    }

    const searchEnd = Math.min(offset + target, text.length)
    const spaceIdx = text.lastIndexOf(" ", searchEnd - 1)
    const breakAt = spaceIdx > offset ? spaceIdx + 1 : searchEnd

    parts.push({
      text: text.slice(offset, breakAt),
      start: seg.start + offset,
      end: seg.start + breakAt,
    })
    offset = breakAt
  }

  return parts
}

interface Acc {
  chunks: TextChunk[]
  buf: Buffer
}

const flush = (acc: Acc): Acc =>
  acc.buf.segments.length === 0
    ? acc
    : { chunks: [...acc.chunks, toChunk(acc.buf)], buf: emptyBuffer(acc.buf.end) }

const processSegment = (
  acc: Acc,
  seg: Segment,
  config: ChunkConfig,
  sizeOf: (s: Segment) => number
): Acc => {
  const shouldBreak = config.breakBefore?.(seg) ?? false
  const flushed = shouldBreak && acc.buf.segments.length > 0 ? flush(acc) : acc

  const size = sizeOf(seg)

  const maxSegment = config.maxSegment ?? config.target
  if (size > maxSegment) {
    const parts = forceSplitSegment(seg, config.target)
    return parts.reduce((a, part) => processSegment(a, part, config, sizeOf), flushed)
  }

  const combined = flushed.buf.size + size
  if (combined > config.target && flushed.buf.size >= config.min) {
    const afterFlush = flush(flushed)
    return { ...afterFlush, buf: appendSegment(afterFlush.buf, seg, size) }
  }

  return { ...flushed, buf: appendSegment(flushed.buf, seg, size) }
}

const mergeTinyTail = (chunks: TextChunk[], minSize: number): TextChunk[] => {
  if (chunks.length <= 1) return chunks
  const last = chunks[chunks.length - 1]
  if (last.text.length >= minSize) return chunks
  const prev = chunks[chunks.length - 2]
  const merged: TextChunk = {
    text: prev.text + last.text,
    start: prev.start,
    end: last.end,
  }
  return [...chunks.slice(0, -2), merged]
}

export const chunk = (segments: Segment[], config: ChunkConfig): TextChunk[] => {
  if (segments.length === 0) return []

  const sizeOf = config.sizeOf ?? defaultSizeOf
  const initial: Acc = { chunks: [], buf: emptyBuffer(segments[0].start) }
  const result = flush(
    segments.reduce((acc, seg) => processSegment(acc, seg, config, sizeOf), initial)
  )

  return mergeTinyTail(result.chunks, Math.floor(config.min / 2))
}
