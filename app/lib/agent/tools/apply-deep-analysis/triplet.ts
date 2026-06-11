import type { Envelope } from "./envelope"

export interface EnvelopeMapping {
  index: number
  envelopeId: string
  code: string
}

export interface RenderedEnvelopes {
  blocks: string[]
  mapping: EnvelopeMapping[]
}

const buildEnvelopeBlock = (env: Envelope, displayIndex: number, halo: number): string => {
  const sentences = env.haloSentences
  const beforeCount = Math.min(halo, env.markedStart - 1)
  const before = sentences.slice(env.markedStart - 1 - beforeCount, env.markedStart - 1).join(" ")

  const afterCount = Math.min(halo, sentences.length - env.markedEnd)
  const after = sentences.slice(env.markedEnd, env.markedEnd + afterCount).join(" ")

  const candidateText =
    sentences.slice(env.markedStart - 1, env.markedEnd).join(" ") || env.markedText

  const lines: string[] = [`<target id="${displayIndex}" code="${env.code}">`]
  if (before) lines.push(before)
  lines.push(`<marked>${candidateText}</marked>`)
  if (after) lines.push(after)
  if (env.reason !== undefined) lines.push(`<keep-case>${env.reason}</keep-case>`)
  if (env.review !== undefined) lines.push(`<remove-case>${env.review}</remove-case>`)
  lines.push("</target>")
  return lines.join("\n")
}

export const renderEnvelopeBlocks = (
  envelopes: readonly Envelope[],
  halo: number
): RenderedEnvelopes => {
  const blocks: string[] = []
  const mapping: EnvelopeMapping[] = []
  envelopes.forEach((env, i) => {
    const displayIndex = i + 1
    mapping.push({ index: displayIndex, envelopeId: env.id, code: env.code })
    blocks.push(buildEnvelopeBlock(env, displayIndex, halo))
  })
  return { blocks, mapping }
}
