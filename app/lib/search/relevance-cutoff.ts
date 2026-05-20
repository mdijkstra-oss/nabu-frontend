import { z } from "zod"
import type { ScoredChunk } from "./fusion"
import { callAndParse } from "~/lib/agent/client/call-parse"

export interface CutoffBand {
  lo: number
  hi: number
}

export interface ProbeGroup<T> {
  position: number
  items: T[]
}

export type JudgeFn = (intent: string, snippets: string[]) => Promise<boolean[]>

export const SAMPLES_PER_PROBE = 5

export const sampleAtQuintiles = <T>(
  items: T[],
  band: CutoffBand,
  samplesPerProbe: number
): ProbeGroup<T>[] => {
  const bandSize = band.hi - band.lo
  if (bandSize <= 0) return []

  const halfWindow = Math.floor(samplesPerProbe / 2)

  return QUINTILE_FRACTIONS.reduce<ProbeGroup<T>[]>((groups, fraction) => {
    const center = band.lo + Math.floor(bandSize * fraction)
    const clampedCenter = Math.min(Math.max(center, band.lo), band.hi - 1)
    const start = Math.max(band.lo, clampedCenter - halfWindow)
    const end = Math.min(band.hi, start + samplesPerProbe)
    const adjustedStart = Math.max(band.lo, end - samplesPerProbe)

    const sampled = items.slice(adjustedStart, end)
    if (sampled.length > 0) {
      groups.push({ position: clampedCenter, items: sampled })
    }

    return groups
  }, [])
}

export const findCutoffBand = (
  judgments: boolean[][],
  positions: number[],
  outerBand: CutoffBand
): CutoffBand => {
  if (judgments.length === 0) return outerBand

  const majorityResults = judgments.map(isMajorityRelevant)
  const firstFalseIdx = majorityResults.indexOf(false)

  if (firstFalseIdx === -1) return { lo: positions[positions.length - 1], hi: outerBand.hi }
  if (!majorityResults.includes(true)) return { lo: outerBand.lo, hi: positions[0] }

  const lastTrueBeforeFalse = majorityResults.reduce(
    (last, val, idx) => (val && idx < firstFalseIdx ? idx : last),
    -1
  )

  const lo = lastTrueBeforeFalse >= 0 ? positions[lastTrueBeforeFalse] : outerBand.lo
  const hi = positions[firstFalseIdx]

  return { lo, hi }
}

export const findRelevanceCutoff = async (
  ranked: ScoredChunk[],
  intent: string,
  judge: JudgeFn
): Promise<number> => {
  if (ranked.length === 0) return 0

  let band: CutoffBand = { lo: 0, hi: ranked.length }

  while (band.hi - band.lo > SAMPLES_PER_PROBE) {
    const probes = sampleAtQuintiles(ranked, band, SAMPLES_PER_PROBE)
    if (probes.length === 0) break

    const allSnippets = probes.flatMap((p) => p.items.map(chunkToSnippet))
    const allJudgments = await judge(intent, allSnippets)
    const { grouped, positions } = splitJudgments(allJudgments, probes)

    band = findCutoffBand(grouped, positions, band)
  }

  return band.lo
}

export const judgeSnippets: JudgeFn = async (
  intent: string,
  snippets: string[]
): Promise<boolean[]> => {
  const result = await callAndParse(
    EMBEDDINGS_JUDGE_ENDPOINT,
    [
      {
        type: "message" as const,
        role: "system" as const,
        content: `Search intent: ${intent}\n\n${formatSnippets(snippets)}`,
      },
      {
        type: "message" as const,
        role: "user" as const,
        content: "Judge these.",
      },
    ],
    EmbeddingsJudgeResponse
  )

  if (!result.ok) return snippets.map(() => true)

  const lookup = new Map(result.data.results.map((r) => [r.index, r.relevant]))
  return snippets.map((_, i) => lookup.get(i + 1) ?? true)
}

const QUINTILE_FRACTIONS = [0.2, 0.4, 0.6, 0.8]

const isMajorityRelevant = (judgments: boolean[]): boolean => {
  const relevant = judgments.filter(Boolean).length
  return relevant > judgments.length / 2
}

const chunkToSnippet = (chunk: ScoredChunk): string => chunk.text ?? chunk.file

const splitJudgments = (
  allJudgments: boolean[],
  probes: ProbeGroup<unknown>[]
): { grouped: boolean[][]; positions: number[] } => {
  let offset = 0
  const grouped: boolean[][] = []
  const positions: number[] = []

  for (const probe of probes) {
    grouped.push(allJudgments.slice(offset, offset + probe.items.length))
    positions.push(probe.position)
    offset += probe.items.length
  }

  return { grouped, positions }
}

const EMBEDDINGS_JUDGE_ENDPOINT = "/embeddings-judge"

const EmbeddingsJudgeResponse = z.object({
  results: z.array(
    z.object({
      index: z.number(),
      relevant: z.boolean(),
    })
  ),
})

const formatSnippet = (index: number, text: string): string => `[${index + 1}] ${text}`

const formatSnippets = (snippets: string[]): string =>
  snippets.map((text, i) => formatSnippet(i, text)).join("\n\n")
