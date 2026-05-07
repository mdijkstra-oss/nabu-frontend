import type { AnalysisResult } from "~/lib/agent/tools/apply-deep-analysis/format"

export interface BenchConfig {
  label: string
  target: string
  framework: string[]
  dimensions: string[]
  runs: number
  host: string
  outDir: string
}

export interface SectionResult {
  startLine: number
  endLine: number
  sentenceCount: number
  results: AnalysisResult[]
}

export interface CallRecord {
  endpoint: string
  durationMs: number
  requestChars: number
  ok: boolean
}

export interface RunOutput {
  index: number
  sections: SectionResult[]
  calls: CallRecord[]
  durationMs: number
}

export interface BenchMeta {
  label: string
  target: string
  framework: string[]
  dimensions: string[]
  runs: number
  host: string
  startedAt: string
  completedAt: string
  durationMs: number
}

export interface CostEntry {
  endpoint: string
  model: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  inputCost: number
  cachedInputCost: number
  outputCost: number
  reasoningCost: number
  totalCost: number
  durationMs: number
}

export interface CostSummary {
  total: {
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    costUsd: number
    calls: number
  }
  byEndpoint: Record<
    string,
    {
      calls: number
      inputTokens: number
      outputTokens: number
      costUsd: number
    }
  >
  entries: CostEntry[]
}
