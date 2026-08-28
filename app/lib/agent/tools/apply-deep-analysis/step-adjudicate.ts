import type { ScopedSources, ContentResolver, ParseCall } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildAnalysisCallShape, ADJUDICATE_CTA, buildAdjudicateSchema } from "./messages"
import {
  ADJUDICATE_ENDPOINT,
  ENVELOPES_PER_CALL,
  MAX_CHARS_PER_CALL,
  MAX_CODES_PER_MIXED_CALL,
  POST_FIND_CONCURRENCY,
} from "./def"
import { processPool } from "~/lib/utils/pool"
import { noop } from "~/lib/utils/noop"
import { errorMessage } from "~/lib/utils/error"
import type { CoderSelection } from "./step-code"
import { sentencesInRange } from "./coding-chunk"
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

export interface Verdict {
  judgment: "keep" | "reject" | "inconsistent"
  reason: string
}

const selectedText = (selection: CoderSelection): string =>
  sentencesInRange(selection.candidate.chunk, selection.start, selection.end)
    .map((sentence) => sentence.text)
    .join(" ")

export const contestedEntry = (selection: CoderSelection): EntryInput<CoderSelection> => {
  const other = selection.coder === "voter-one" ? "voter-two" : "voter-one"
  return {
    item: selection,
    file: selection.candidate.chunk.file,
    children: [
      { tag: "code", body: selection.candidate.code },
      {
        tag: "candidate",
        attributes: { start: String(selection.start), end: String(selection.end) },
        body: selectedText(selection),
      },
      { tag: selection.coder, attributes: { status: "selected" }, body: selection.reason },
      { tag: other, attributes: { status: "not selected" }, body: "" },
    ],
    content: { numbered: selection.candidate.chunk.sentences.map((sentence) => sentence.text) },
  }
}

const packContested = (selections: readonly CoderSelection[]): CoderSelection[][] =>
  pack(selections, {
    sizeOf: (selection) => entrySize(contestedEntry(selection)),
    maxChars: MAX_CHARS_PER_CALL,
    maxItems: ENVELOPES_PER_CALL,
    groupKey: (selection) => selection.candidate.code,
    maxGroups: MAX_CODES_PER_MIXED_CALL,
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
  batch: CoderSelection[],
  sources: ScopedSources,
  resolve: ContentResolver,
  parse: ParseCall
): Promise<CodingAdjudicationResult> => {
  const entries = assignIds(batch.map(contestedEntry))
  const codes = new Set(batch.map((selection) => selection.candidate.code))
  const shape = buildAnalysisCallShape(codes, sources, resolve, ADJUDICATE_CTA)
  const result = await parse(
    ADJUDICATE_ENDPOINT,
    buildEntryMessages(shape, entries),
    buildAdjudicateSchema([...codes])
  )
  if (!result.ok) return { accepted: [], errors: [result.error] }

  const verdicts = new Map<CoderSelection, Verdict>()
  for (const raw of result.data.results) {
    const entry: Entry<CoderSelection> | undefined = entries.find(
      (candidate) => candidate.id === raw.id
    )
    if (!entry || raw.code !== entry.item.candidate.code) continue
    verdicts.set(entry.item, { judgment: raw.judgment, reason: raw.reason })
  }

  const accepted: CodingDecision[] = []
  const errors: string[] = []
  for (const selection of batch) {
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
  const pool = await processPool(
    packContested(selections),
    async (batch) => [await adjudicateContestedBatch(batch, sources, resolve, parse)],
    noop,
    { concurrency: POST_FIND_CONCURRENCY }
  )
  const accepted = pool.results.flatMap((result) => result.accepted)
  const errors = pool.results.flatMap((result) => result.errors)
  for (const failure of pool.failures) errors.push(errorMessage(failure.error))
  return { accepted: dedupCodingDecisions(accepted), errors }
}
