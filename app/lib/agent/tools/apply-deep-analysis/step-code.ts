import type { ParseCall, ScopedSources, ContentResolver } from "./messages"
import { buildAnalysisCallShape, buildFilterSchema, FILTER_CTA } from "./messages"
import type { CodingChunk } from "./coding-chunk"
import type { FilterVoter } from "./def"
import {
  CHUNKS_PER_CALL,
  FILTER_ENDPOINT,
  MAX_CHARS_PER_CALL,
  MAX_CODES_PER_CALL,
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
import { groupBy } from "~/lib/utils/group"
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

export interface CodingChunkCandidates {
  chunk: CodingChunk
  candidates: CodingCandidate[]
}

export const groupCodingCandidates = (
  candidates: readonly CodingCandidate[]
): CodingChunkCandidates[] =>
  [...groupBy(candidates, (candidate) => candidate.chunk.id).values()].map((group) => ({
    chunk: group[0].chunk,
    candidates: group,
  }))

export const codingEntry = (group: CodingChunkCandidates): EntryInput<CodingChunkCandidates> => ({
  item: group,
  file: group.chunk.file,
  content: { numbered: group.chunk.sentences.map((sentence) => sentence.text) },
})

export const packCodingChunks = (
  groups: readonly CodingChunkCandidates[]
): CodingChunkCandidates[][] =>
  pack(groups, {
    sizeOf: (group) => entrySize(codingEntry(group)),
    maxChars: MAX_CHARS_PER_CALL,
    maxItems: CHUNKS_PER_CALL,
  })

export const batchCodeIds = (codes: Iterable<string>): ReadonlySet<string>[] =>
  pack([...new Set(codes)], {
    sizeOf: () => 0,
    maxChars: Infinity,
    maxItems: MAX_CODES_PER_CALL,
  }).map((batch) => new Set(batch))

const resolveSelection = (
  raw: { code: string; start: string; end: string; reason: string },
  entries: readonly Entry<CodingChunkCandidates>[],
  coder: FilterVoter
): CoderSelection | null => {
  const start = resolveRef(raw.start, entries)
  const end = resolveRef(raw.end, entries)
  if (!start || !end || start.entry !== end.entry || end.sentenceIndex < start.sentenceIndex)
    return null
  const candidate = start.entry.item.candidates.find((item) => item.code === raw.code)
  if (!candidate) return null
  return {
    candidate,
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
  groups: CodingChunkCandidates[],
  codes: ReadonlySet<string>,
  coders: readonly FilterVoter[],
  sources: ScopedSources,
  resolve: ContentResolver,
  parse: ParseCall
): Promise<BatchCoderResult> => {
  const entries = assignIds(groups.map(codingEntry))
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
  const groups = groupCodingCandidates(candidates)
  const chunkBatches = packCodingChunks(groups)
  const batches = batchCodeIds(candidates.map((candidate) => candidate.code)).flatMap((codes) =>
    chunkBatches.map((groups) => ({ codes, groups }))
  )
  const pool = await processPool(
    batches,
    async ({ codes, groups }) => [await codeBatch(groups, codes, coders, sources, resolve, parse)],
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
