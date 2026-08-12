import {
  assignIds,
  entrySize,
  type Entry,
  type EntryChild,
  type EntryInput,
  type PlainSegment,
} from "~/lib/calls/entry"
import { pack } from "~/lib/calls/pack"
import type { Envelope } from "./envelope"
import {
  ENVELOPES_PER_CALL,
  MAX_CHARS_PER_CALL,
  MAX_CODES_PER_MIXED_CALL,
  SPAN_STEP_CONTEXT_SENTENCES,
} from "./def"

export const envelopeEntry = (env: Envelope, halo: number): EntryInput<Envelope> => ({
  item: env,
  file: env.file,
  children: envelopeChildren(env),
  content: { plain: envelopeSegments(env, halo) },
})

export const envelopeEntries = (envelopes: readonly Envelope[]): Entry<Envelope>[] =>
  assignIds(envelopes.map((env) => envelopeEntry(env, SPAN_STEP_CONTEXT_SENTENCES)))

export const findEnvelope = (
  entries: readonly Entry<Envelope>[],
  id: number
): Envelope | undefined => entries.find((entry) => entry.id === id)?.item

export const packEnvelopes = (envelopes: readonly Envelope[]): Envelope[][] =>
  pack(envelopes, {
    sizeOf: (env) => entrySize(envelopeEntry(env, SPAN_STEP_CONTEXT_SENTENCES)),
    maxChars: MAX_CHARS_PER_CALL,
    maxItems: ENVELOPES_PER_CALL,
    groupKey: (env) => env.code,
    maxGroups: MAX_CODES_PER_MIXED_CALL,
  })

const envelopeChildren = (env: Envelope): EntryChild[] => [
  { tag: "code", body: env.code },
  ...(env.reason !== undefined ? [{ tag: "keep-case", body: env.reason }] : []),
  ...(env.review !== undefined ? [{ tag: "remove-case", body: env.review }] : []),
]

const envelopeSegments = (env: Envelope, halo: number): PlainSegment[] => {
  const sentences = env.haloSentences

  const beforeCount = Math.min(halo, env.markedStart - 1)
  const before = sentences.slice(env.markedStart - 1 - beforeCount, env.markedStart - 1).join(" ")

  const afterCount = Math.min(halo, sentences.length - env.markedEnd)
  const after = sentences.slice(env.markedEnd, env.markedEnd + afterCount).join(" ")

  const candidate = sentences.slice(env.markedStart - 1, env.markedEnd).join(" ") || env.markedText

  return [
    ...(before ? [before] : []),
    { tag: "marked", body: candidate },
    ...(after ? [after] : []),
  ]
}
