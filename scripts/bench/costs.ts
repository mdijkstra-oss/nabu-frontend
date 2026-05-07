import { readFileSync } from "node:fs"
import type { CostEntry, CostSummary } from "./types"

interface LogLine {
  msg?: string
  component?: string
  data?: Record<string, unknown>
}

const tryParseLogLine = (line: string): LogLine | null => {
  try {
    return JSON.parse(line) as LogLine
  } catch {
    return null
  }
}

const isUsageLine = (parsed: LogLine): boolean =>
  parsed.component === "usage" && parsed.msg === "call completed"

const toNumber = (v: unknown): number => (typeof v === "number" ? v : 0)

const toCostEntry = (data: Record<string, unknown>): CostEntry => ({
  endpoint: String(data.endpoint ?? ""),
  model: String(data.model ?? ""),
  inputTokens: toNumber(data.input_tokens),
  cachedInputTokens: toNumber(data.cached_input_tokens),
  outputTokens: toNumber(data.output_tokens),
  reasoningTokens: toNumber(data.reasoning_tokens),
  inputCost: toNumber(data.input_cost),
  cachedInputCost: toNumber(data.cached_input_cost),
  outputCost: toNumber(data.output_cost),
  reasoningCost: toNumber(data.reasoning_cost),
  totalCost: toNumber(data.total_cost),
  durationMs: toNumber(data.duration_ms),
})

const extractEntries = (lines: string[]): CostEntry[] =>
  lines.reduce<CostEntry[]>((acc, line) => {
    const parsed = tryParseLogLine(line)
    if (!parsed || !isUsageLine(parsed) || !parsed.data) return acc
    return [...acc, toCostEntry(parsed.data)]
  }, [])

const sumEntries = (entries: CostEntry[]): CostSummary["total"] =>
  entries.reduce(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      reasoningTokens: acc.reasoningTokens + e.reasoningTokens,
      costUsd: acc.costUsd + e.totalCost,
      calls: acc.calls + 1,
    }),
    { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, calls: 0 }
  )

const groupByEndpoint = (
  entries: CostEntry[]
): CostSummary["byEndpoint"] =>
  entries.reduce<CostSummary["byEndpoint"]>((acc, e) => {
    const prev = acc[e.endpoint] ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
    return {
      ...acc,
      [e.endpoint]: {
        calls: prev.calls + 1,
        inputTokens: prev.inputTokens + e.inputTokens,
        outputTokens: prev.outputTokens + e.outputTokens,
        costUsd: prev.costUsd + e.totalCost,
      },
    }
  }, {})

export const parseServerLog = (logPath: string): CostSummary => {
  const content = readFileSync(logPath, "utf-8")
  const lines = content.split("\n").filter((l) => l.trim())
  const entries = extractEntries(lines)

  return {
    total: sumEntries(entries),
    byEndpoint: groupByEndpoint(entries),
    entries,
  }
}
