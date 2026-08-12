import { callAndParse } from "~/lib/agent/client/call-parse"
import {
  assignIds,
  buildEntryMessages,
  renderEntry,
  resolveRef,
  type Entry,
  type EntryChild,
  type EntryInput,
} from "~/lib/calls/entry"
import { pack } from "~/lib/calls/pack"
import { runRounds, type BatchOutcome } from "~/lib/calls/rounds"
import { markCallShape } from "./messages"
import { occurrenceOf } from "./hits"
import { repairRange } from "./repair"
import { markSchema, type MarkAnswer } from "./schema"
import type { ParseCall } from "./seam"
import { coalesceStretches, sliceWindow } from "./window"
import type { Mark, MarkJob, MarkWork, Stretch } from "./types"
import { DETECT_CALL_MAX_CHARS } from "./types"

export const MARK_ENDPOINT = "/region-marker"

export const MARK_MAX_STRETCHES = 10

const MARK_CONCURRENCY = 5

export const runMark = async (
  items: MarkWork[],
  job: MarkJob,
  parse: ParseCall = callAndParse
): Promise<void> => {
  const { unrecorded } = await runRounds(items, {
    pack: packStretchBatches,
    call: (batch) => callBatch(batch, job, parse),
    identityOf: occurrenceIdentity,
    concurrency: MARK_CONCURRENCY,
    onAnswered: job.onAnswered,
    onAbandoned: job.onFailed,
  })

  for (const work of unrecorded) job.onFailed(work)
}

// The requeue unit is the occurrence, so each round re-coalesces what is still pending —
// answered neighbours are gone and the new stretch is smaller. A batch is whole stretches
// flattened; the call re-derives them, which is deterministic on the same hits.
const packStretchBatches = (pending: MarkWork[]): MarkWork[][] => {
  const stretches = coalesceStretches(pending)
  const batches = pack(stretches, {
    sizeOf: stretchSize,
    maxChars: DETECT_CALL_MAX_CHARS,
    maxItems: MARK_MAX_STRETCHES,
  })
  return batches.map((batch) => batch.flatMap((stretch) => stretch.works))
}

const occurrenceIdentity = (work: MarkWork): string =>
  [work.file, work.hit.kind, occurrenceOf(work.hit)].join("\u0000")

const toEntryInput = (stretch: Stretch): EntryInput<Stretch> => ({
  item: stretch,
  file: stretch.file,
  content: { numbered: sliceWindow(stretch.sentences, stretch.window) },
})

const occurrenceChild = (entry: Entry<Stretch>, work: MarkWork, ordinal: number): EntryChild => ({
  tag: "occurrence",
  attributes: {
    n: String(ordinal),
    ref: `${entry.id}.${work.hit.hitSentence - entry.item.window.start + 1}`,
  },
  body: work.hit.quote,
})

const withOccurrences = (entry: Entry<Stretch>): Entry<Stretch> => ({
  ...entry,
  children: entry.item.works.map((work, i) => occurrenceChild(entry, work, i + 1)),
})

const toEntries = (stretches: Stretch[]): Entry<Stretch>[] =>
  assignIds(stretches.map(toEntryInput)).map(withOccurrences)

const stretchSize = (stretch: Stretch): number =>
  renderEntry(withOccurrences({ ...toEntryInput(stretch), id: 1 })).length

const callBatch = async (
  batch: MarkWork[],
  job: MarkJob,
  parse: ParseCall
): Promise<BatchOutcome<MarkWork, Mark>> => {
  const entries = toEntries(coalesceStretches(batch))
  const messages = buildEntryMessages(markCallShape(job.kind.rules), entries)

  const result = await parse(MARK_ENDPOINT, messages, markSchema)
  if (!result.ok) {
    console.error(`[region-mark] call failed (${job.kind.id}):`, result.error)
    return { answered: false, error: result.error }
  }

  const results = new Map<MarkWork, Mark>()
  for (const row of result.data.results) {
    const marked = resolveAnswer(entries, row)
    if (marked) results.set(marked.work, marked.mark)
  }
  return { answered: true, results }
}

// An (entry, n) naming no occurrence in the call is dropped, as is a range ref that
// resolves outside the occurrence's own entry.
const resolveAnswer = (
  entries: Entry<Stretch>[],
  row: MarkAnswer
): { work: MarkWork; mark: Mark } | null => {
  const entry = entries.find((candidate) => candidate.id === row.entry)
  const work = entry?.item.works[row.n - 1]
  if (!entry || !work) return null

  const start = resolveRef(row.start, entries)
  const end = resolveRef(row.end, entries)
  if (!start || !end || start.entry !== entry || end.entry !== entry) return null

  const windowStart = entry.item.window.start
  const range = repairRange(
    {
      hitSentence: work.hit.hitSentence,
      windowStart,
      windowEnd: entry.item.window.end,
    },
    { start: windowStart + start.sentenceIndex, end: windowStart + end.sentenceIndex }
  )

  return { work, mark: { ...work.hit, ...range } }
}
