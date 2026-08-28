import type { ParseCall, ScopedSources, ContentResolver } from "./messages"
import { buildAnalysisCallShape, buildFilterSchema, FILTER_CTA } from "./messages"
import type { CodingChunk } from "./coding-chunk"
import type { FilterVoter } from "./def"
import {
  ENVELOPES_PER_CALL,
  FILTER_ENDPOINT,
  MAX_CHARS_PER_CALL,
  MAX_CODES_PER_MIXED_CALL,
  POST_FIND_CONCURRENCY,
} from "./def"
import { callAndParse } from "../../client/call-parse"
import {
  assignIds,
  buildEntryMessages,
  entrySize,
  resolveRef,
  type Entry,
  type EntryInput,
} from "~/lib/calls/entry"
import { pack } from "~/lib/calls/pack"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"

export interface CodingCandidate {
  code: string
  dimensionPath: string
  chunk: CodingChunk
}

export interface CoderSelection {
  candidate: CodingCandidate
  coder: FilterVoter
  start: number
  end: number
  reason: string
}

export interface CoderResult {
  selections: Map<FilterVoter, CoderSelection[]>
  errors: string[]
}

export const codingEntry = (candidate: CodingCandidate): EntryInput<CodingCandidate> => ({
  item: candidate,
  file: candidate.chunk.file,
  children: [{ tag: "code", body: candidate.code }],
  content: { numbered: candidate.chunk.sentences.map((sentence) => sentence.text) },
})

export const packCodingCandidates = (candidates: readonly CodingCandidate[]): CodingCandidate[][] =>
  pack(candidates, {
    sizeOf: (candidate) => entrySize(codingEntry(candidate)),
    maxChars: MAX_CHARS_PER_CALL,
    maxItems: ENVELOPES_PER_CALL,
    groupKey: (candidate) => candidate.code,
    maxGroups: MAX_CODES_PER_MIXED_CALL,
  })

const resolveSelection = (
  raw: { code: string; start: string; end: string; reason: string },
  entries: readonly Entry<CodingCandidate>[],
  coder: FilterVoter
): CoderSelection | null => {
  const start = resolveRef(raw.start, entries)
  const end = resolveRef(raw.end, entries)
  if (!start || !end || start.entry !== end.entry || end.sentenceIndex < start.sentenceIndex)
    return null
  if (raw.code !== start.entry.item.code) return null
  return {
    candidate: start.entry.item,
    coder,
    start: start.sentenceIndex + 1,
    end: end.sentenceIndex + 1,
    reason: raw.reason,
  }
}

const dedupSelections = (selections: readonly CoderSelection[]): CoderSelection[] => {
  const seen = new Set<string>()
  return selections.filter((selection) => {
    const key = `${selection.candidate.code}:${selection.candidate.chunk.id}:${selection.start}:${selection.end}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

interface BatchCoderResult extends CoderResult {}

const codeBatch = async (
  candidates: CodingCandidate[],
  coders: readonly FilterVoter[],
  sources: ScopedSources,
  resolve: ContentResolver,
  parse: ParseCall
): Promise<BatchCoderResult> => {
  const entries = assignIds(candidates.map(codingEntry))
  const codes = new Set(candidates.map((candidate) => candidate.code))
  const messages = buildEntryMessages(
    buildAnalysisCallShape(codes, sources, resolve, FILTER_CTA),
    entries
  )
  const responses = await Promise.all(
    coders.map(async (coder) => ({
      coder,
      result: await parse(`${FILTER_ENDPOINT}.${coder}`, messages, buildFilterSchema([...codes])),
    }))
  )

  const failed = responses.filter(({ result }) => !result.ok)
  if (failed.length > 0) {
    return {
      selections: new Map(coders.map((coder) => [coder, []])),
      errors: failed.map(({ coder, result }) =>
        result.ok ? "" : `${FILTER_ENDPOINT}.${coder}: ${result.error}`
      ),
    }
  }

  const selections = new Map<FilterVoter, CoderSelection[]>()
  for (const { coder, result } of responses) {
    if (!result.ok) continue
    selections.set(
      coder,
      dedupSelections(
        result.data.results.flatMap((raw) => resolveSelection(raw, entries, coder) ?? [])
      )
    )
  }
  return { selections, errors: [] }
}

export const runCoders = async (
  candidates: CodingCandidate[],
  coders: readonly FilterVoter[],
  sources: ScopedSources,
  resolve: ContentResolver,
  parse: ParseCall = callAndParse
): Promise<CoderResult> => {
  const batches = packCodingCandidates(candidates)
  const pool = await processPool(
    batches,
    async (batch) => [await codeBatch(batch, coders, sources, resolve, parse)],
    noop,
    { concurrency: POST_FIND_CONCURRENCY }
  )

  const selections = new Map<FilterVoter, CoderSelection[]>(
    coders.map((coder) => [coder, [] as CoderSelection[]])
  )
  const errors: string[] = []
  for (const batch of pool.results) {
    errors.push(...batch.errors)
    for (const coder of coders) selections.get(coder)?.push(...(batch.selections.get(coder) ?? []))
  }
  for (const failure of pool.failures) errors.push(errorMessage(failure.error))
  return { selections, errors }
}
