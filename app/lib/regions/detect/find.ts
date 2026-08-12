import { callAndParse } from "~/lib/agent/client/call-parse"
import {
  assignIds,
  buildEntryMessages,
  entrySize,
  resolveRef,
  type Entry,
  type EntryInput,
} from "~/lib/calls/entry"
import { pack } from "~/lib/calls/pack"
import { runRounds, type BatchOutcome } from "~/lib/calls/rounds"
import type { RegionValueType } from "~/lib/regions/kinds/registry"
import { gateOccurrences, type OccurrenceCandidate } from "./hits"
import { findCallShape } from "./messages"
import { buildFindSchema, type FindAnswer } from "./schema"
import type { ParseCall } from "./seam"
import type { FindJob, FindRunResult, FindWork, Hit } from "./types"
import { DETECT_CALL_MAX_CHARS, FIND_MAX_ITEMS } from "./types"

export { FIND_MAX_ITEMS } from "./types"

export const FIND_ENDPOINT = "/region-finder"

const POOLED_CONCURRENCY = 5
const SERIAL_CONCURRENCY = 1

const NEEDS_SHARED_VOCABULARY: Record<RegionValueType, boolean> = {
  string: true,
  datetime: false,
}

export const needsSharedVocabulary = (valueType: RegionValueType): boolean =>
  NEEDS_SHARED_VOCABULARY[valueType]

export const runFind = async (
  items: FindWork[],
  job: FindJob,
  parse: ParseCall = callAndParse
): Promise<FindRunResult> => {
  const serial = needsSharedVocabulary(job.kind.valueType)
  const foundValues: string[] = []

  const growVocabulary = (): void => {
    for (const value of foundValues) job.knownValues.add(value)
    foundValues.length = 0
  }

  const { unrecorded } = await runRounds(items, {
    pack: (pending) =>
      pack(pending, {
        sizeOf: workSize,
        maxChars: DETECT_CALL_MAX_CHARS,
        maxItems: FIND_MAX_ITEMS,
      }),
    call: (batch) => callBatch(batch, job, parse),
    identityOf: (work) => `${work.file}\u0000${work.unit.hash}`,
    concurrency: serial ? SERIAL_CONCURRENCY : POOLED_CONCURRENCY,
    onAnswered: (work, hits) => {
      foundValues.push(...hits.map((hit) => hit.value))
      job.onAnswered(work, hits)
    },
    onAbandoned: job.onAbandoned,
    onCallAnswered: growVocabulary,
  })

  return { unrecorded }
}

const toEntryInput = (work: FindWork): EntryInput<FindWork> => ({
  item: work,
  file: work.file,
  content: { numbered: work.sentences },
})

const workSize = (work: FindWork): number => entrySize(toEntryInput(work))

const callBatch = async (
  batch: FindWork[],
  job: FindJob,
  parse: ParseCall
): Promise<BatchOutcome<FindWork, Hit[]>> => {
  const entries = assignIds(batch.map(toEntryInput))
  const known = needsSharedVocabulary(job.kind.valueType) ? [...job.knownValues] : null
  const shape = findCallShape(job.kind.rules, known)

  const result = await parse(
    FIND_ENDPOINT,
    buildEntryMessages(shape, entries),
    buildFindSchema(job.kind.valueType)
  )
  if (!result.ok) {
    console.error(`[region-find] call failed (${job.kind.id}):`, result.error)
    return { answered: false, error: result.error }
  }

  return { answered: true, results: routeAnswers(job, entries, result.data.results) }
}

// Acknowledgment is the row naming the entry; each occurrence lands in the entry its
// ref resolves into. A ref resolving to nothing — or into an entry the answer never
// acknowledged — drops the occurrence, never the acknowledgment.
const routeAnswers = (
  job: FindJob,
  entries: Entry<FindWork>[],
  rows: FindAnswer[]
): Map<FindWork, Hit[]> => {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const candidates = new Map<Entry<FindWork>, OccurrenceCandidate[]>()

  for (const row of rows) {
    const entry = byId.get(row.entry)
    if (entry && !candidates.has(entry)) candidates.set(entry, [])
  }

  for (const row of rows) {
    if (!byId.has(row.entry)) continue
    for (const occurrence of row.occurrences) {
      const resolved = resolveRef(occurrence.ref, entries)
      if (!resolved) continue
      candidates.get(resolved.entry)?.push({
        quote: occurrence.quote,
        sentenceIndex: resolved.sentenceIndex,
        value: occurrence.value,
      })
    }
  }

  return new Map(
    [...candidates].map(([entry, occurrences]) => [
      entry.item,
      gateOccurrences(job.kind.id, job.kind.valueType, entry.item, occurrences),
    ])
  )
}
