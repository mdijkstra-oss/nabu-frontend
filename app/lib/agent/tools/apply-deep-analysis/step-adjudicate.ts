import type { ScopedSources, ContentResolver, ParseCall } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildAnalysisCallShape, ADJUDICATE_CTA, buildAdjudicateSchema } from "./messages"
import {
  ADJUDICATE_ENDPOINT,
  CHUNKS_PER_CALL,
  MAX_CHARS_PER_CALL,
  POST_FIND_CONCURRENCY,
} from "./def"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import { batchCodeIds, type CoderSelection } from "./step-code"
import type { CodingChunk } from "./coding-chunk"
import type { CodingDecision } from "./consensus"
import { dedupCodingDecisions } from "./consensus"
import {
  assignIds,
  buildEntryMessages,
  entrySize,
  type Entry,
  type EntryInput,
} from "~/lib/calls/entry"
import { pack } from "~/lib/calls/pack"
import { groupBy } from "~/lib/utils/group"

export interface Verdict {
  judgment: "keep" | "reject" | "inconsistent"
  reason: string
}

export interface ContestedChunk {
  chunk: CodingChunk
  disputes: CoderSelection[]
}

export const groupContestedSelections = (selections: readonly CoderSelection[]): ContestedChunk[] =>
  [...groupBy(selections, (selection) => selection.candidate.chunk.id).values()].map(
    (disputes) => ({ chunk: disputes[0].candidate.chunk, disputes })
  )

export const contestedEntry = (group: ContestedChunk): EntryInput<ContestedChunk> => ({
  item: group,
  file: group.chunk.file,
  children: group.disputes.map((selection, index) => ({
    tag: "dispute",
    attributes: {
      id: String(index + 1),
      code: selection.candidate.code,
      start: String(selection.start),
      end: String(selection.end),
      "voter-one": selection.coder === "voter-one" ? "selected" : "not-selected",
      "voter-two": selection.coder === "voter-two" ? "selected" : "not-selected",
    },
    body: selection.reason,
  })),
  content: { numbered: group.chunk.sentences.map((sentence) => sentence.text) },
})

const packContested = (groups: readonly ContestedChunk[]): ContestedChunk[][] =>
  pack(groups, {
    sizeOf: (group) => entrySize(contestedEntry(group)),
    maxChars: MAX_CHARS_PER_CALL,
    maxItems: CHUNKS_PER_CALL,
  })

const decisionFromAdjudication = (
  selection: CoderSelection,
  verdict: Verdict
): CodingDecision | null => {
  if (verdict.judgment === "reject") return null
  return {
    candidate: selection.candidate,
    start: selection.start,
    end: selection.end,
    reason: selection.reason,
    findVotes: selection.coder === "voter-one" ? [true, false] : [false, true],
    ...(verdict.judgment === "inconsistent" ? { review: verdict.reason } : {}),
  }
}

interface CodingAdjudicationResult {
  accepted: CodingDecision[]
  errors: string[]
}

const adjudicateContestedBatch = async (
  batch: ContestedChunk[],
  codes: ReadonlySet<string>,
  sources: ScopedSources,
  resolve: ContentResolver,
  parse: ParseCall
): Promise<CodingAdjudicationResult> => {
  const entries = assignIds(batch.map(contestedEntry))
  const shape = buildAnalysisCallShape(codes, sources, resolve, ADJUDICATE_CTA)
  const result = await parse(
    ADJUDICATE_ENDPOINT,
    buildEntryMessages(shape, entries),
    buildAdjudicateSchema([...codes])
  )
  if (!result.ok) return { accepted: [], errors: [result.error] }

  const verdicts = new Map<CoderSelection, Verdict>()
  for (const raw of result.data.results) {
    const entry: Entry<ContestedChunk> | undefined = entries.find(
      (candidate) => candidate.id === raw.id
    )
    const selection = entry?.item.disputes[raw.dispute - 1]
    if (!selection || raw.code !== selection.candidate.code) continue
    verdicts.set(selection, { judgment: raw.judgment, reason: raw.reason })
  }

  const accepted: CodingDecision[] = []
  const errors: string[] = []
  for (const selection of batch.flatMap((group) => group.disputes)) {
    const verdict = verdicts.get(selection)
    if (!verdict) {
      errors.push(
        `adjudicator returned no verdict for ${selection.candidate.code} in ${selection.candidate.chunk.id}`
      )
      continue
    }
    const decision = decisionFromAdjudication(selection, verdict)
    if (decision) accepted.push(decision)
  }
  return { accepted, errors }
}

export const adjudicateContestedSelections = async (
  selections: CoderSelection[],
  sources: ScopedSources,
  resolve: ContentResolver,
  parse: ParseCall = callAndParse
): Promise<CodingAdjudicationResult> => {
  if (selections.length === 0) return { accepted: [], errors: [] }
  const batches = batchCodeIds(selections.map((selection) => selection.candidate.code)).flatMap(
    (codes) => {
      const groups = groupContestedSelections(
        selections.filter((selection) => codes.has(selection.candidate.code))
      )
      return packContested(groups).map((groups) => ({ codes, groups }))
    }
  )
  const pool = await processPool(
    batches,
    async ({ codes, groups }) => [
      await adjudicateContestedBatch(groups, codes, sources, resolve, parse),
    ],
    noop,
    { concurrency: POST_FIND_CONCURRENCY }
  )
  const accepted = pool.results.flatMap((result) => result.accepted)
  const errors = pool.results.flatMap((result) => result.errors)
  for (const failure of pool.failures) errors.push(errorMessage(failure.error))
  return { accepted: dedupCodingDecisions(accepted), errors }
}
