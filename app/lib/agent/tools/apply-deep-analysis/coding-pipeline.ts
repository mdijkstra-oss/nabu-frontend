import type { FileStore } from "~/lib/files/store"
import type { Target } from "./def"
import type { Envelope } from "./envelope"
import type { ContentResolver, ParseCall, ScopedSources } from "./messages"
import { callAndParse } from "../../client/call-parse"
import { buildCodingChunks, sentencesInRange } from "./coding-chunk"
import type { CodingConfig } from "./coding-config"
import { validateCodingConfig } from "./coding-config"
import {
  passthroughCodingCandidates,
  retrieveCodingCandidates,
  semanticGateCodingCandidates,
  type CandidateStageResult,
  type CodingSearchCtx,
  type RetrievalCall,
} from "./coding-candidates"
import { runCoders, type CodingCandidate } from "./step-code"
import {
  decisionsFromOneCoder,
  dedupCodingDecisions,
  reconcileCoderSelections,
  type CodingDecision,
} from "./consensus"
import { adjudicateContestedSelections } from "./step-adjudicate"

export interface CodingPipelineInput {
  targets: readonly Target[]
  dimensionPaths: readonly string[]
  sources: ScopedSources
  files: FileStore
  resolve: ContentResolver
  search?: CodingSearchCtx
  config: CodingConfig
}

export interface CodingPipelineResult {
  envelopes: Envelope[]
  errors: string[]
}

export interface CodingPipelineDeps {
  parse: ParseCall
  retrieve: RetrievalCall
  semanticGate: (
    candidates: readonly CodingCandidate[],
    files: FileStore,
    resolve: ContentResolver
  ) => Promise<CandidateStageResult>
}

const defaultDeps = {
  parse: callAndParse,
  semanticGate: semanticGateCodingCandidates,
}

const decisionToEnvelope = (decision: CodingDecision): Envelope | null => {
  const { candidate } = decision
  const selected = sentencesInRange(candidate.chunk, decision.start, decision.end)
  const first = selected[0]
  const last = selected[selected.length - 1]
  if (!first || !last) return null
  return {
    id: `${candidate.chunk.id}:${candidate.code}:${first.start}:${last.end}`,
    code: candidate.code,
    file: candidate.chunk.file,
    fileCharStart: first.start,
    fileCharEnd: last.end,
    haloSentences: candidate.chunk.sentences.map((sentence) => sentence.text),
    markedStart: decision.start,
    markedEnd: decision.end,
    markedText: selected.map((sentence) => sentence.text).join(" "),
    score: candidate.chunk.score,
    findVotes: decision.findVotes,
    reason: decision.reason,
    review: decision.review,
  }
}

const sortEnvelopes = (envelopes: Envelope[]): Envelope[] =>
  [...envelopes].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.fileCharStart - b.fileCharStart ||
      a.fileCharEnd - b.fileCharEnd ||
      a.code.localeCompare(b.code)
  )

export const runCodingPipeline = async (
  input: CodingPipelineInput,
  deps: Partial<CodingPipelineDeps> = {}
): Promise<CodingPipelineResult> => {
  const configError = validateCodingConfig(input.config)
  if (configError) return { envelopes: [], errors: [configError] }

  const chunks = buildCodingChunks(
    input.targets,
    (path) => input.files[path] ?? input.resolve(path)
  )
  let candidateResult: CandidateStageResult
  if (input.config.passthrough.has("retrieval")) {
    candidateResult = {
      candidates: passthroughCodingCandidates(chunks, input.dimensionPaths),
      errors: [],
    }
  } else if (!input.search) {
    return { envelopes: [], errors: ["Retrieval is enabled but no search context was provided"] }
  } else {
    candidateResult = deps.retrieve
      ? await retrieveCodingCandidates(chunks, input.dimensionPaths, input.search, deps.retrieve)
      : await retrieveCodingCandidates(chunks, input.dimensionPaths, input.search)
  }

  const errors = [...candidateResult.errors]
  let candidates = candidateResult.candidates
  if (!input.config.passthrough.has("semantic-filter")) {
    const gate = deps.semanticGate ?? defaultDeps.semanticGate
    const gated = await gate(candidates, input.files, input.resolve)
    candidates = gated.candidates
    errors.push(...gated.errors)
  }

  const coderResult = await runCoders(
    candidates,
    input.config.coders,
    input.sources,
    input.resolve,
    deps.parse ?? defaultDeps.parse
  )
  errors.push(...coderResult.errors)

  let decisions: CodingDecision[]
  if (input.config.coders.length === 1) {
    decisions = decisionsFromOneCoder(coderResult.selections.get("voter-one") ?? [])
  } else {
    const reconciled = reconcileCoderSelections(
      coderResult.selections.get("voter-one") ?? [],
      coderResult.selections.get("voter-two") ?? []
    )
    const adjudicated = await adjudicateContestedSelections(
      reconciled.contested,
      input.sources,
      input.resolve,
      deps.parse ?? defaultDeps.parse
    )
    errors.push(...adjudicated.errors)
    decisions = dedupCodingDecisions([...reconciled.accepted, ...adjudicated.accepted])
  }

  return {
    envelopes: sortEnvelopes(decisions.flatMap((decision) => decisionToEnvelope(decision) ?? [])),
    errors,
  }
}
