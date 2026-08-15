import type { RecordedCall } from "./recorder"

export type ReportView = "both" | "replies-only" | "constructed-only"

export type RunOutcome = { kind: "completed" } | { kind: "rejected"; message: string }

export interface RunReport {
  agent: { name: string; constructedLabel: string }
  path: string
  calls: RecordedCall[]
  constructed: unknown
  outcome: RunOutcome
  view: ReportView
  showRequests: boolean
  iteration?: { number: number; of: number }
}

export const hasFailed = (call: RecordedCall): boolean => call.failure !== undefined

export const noun = (word: string, count: number): string => (count === 1 ? word : `${word}s`)

export const render = (report: RunReport): string =>
  [
    ...separator(report),
    header(report),
    ...failures(report.calls),
    ...(report.showRequests ? requests(report.calls) : []),
    ...(report.view === "constructed-only" ? [] : replies(report.calls)),
    ...(report.view === "replies-only" ? [] : constructed(report)),
  ].join("\n")

const RULE = "─".repeat(72)

const separator = (report: RunReport): string[] =>
  report.iteration
    ? [`${RULE}\n▶ iteration ${report.iteration.number} of ${report.iteration.of}`]
    : []

const header = (report: RunReport): string => {
  const failed = report.calls.filter(hasFailed)
  return [
    `try-prompt ${report.agent.name} · ${report.path}`,
    `${report.calls.length} ${noun("call", report.calls.length)}, ${failed.length} failed · ${outcomeOf(report, failed)}`,
  ].join("\n")
}

const outcomeOf = (report: RunReport, failed: RecordedCall[]): string => {
  if (report.outcome.kind === "rejected")
    return `FAILED — the run rejected: ${report.outcome.message}`
  if (failed.length === 0) return "completed"
  const total = report.calls.length
  return `FAILED — ${failed.length} of ${total} ${noun("call", total)} did not get an answer: ${distinctReasons(failed).join("; ")}`
}

const distinctReasons = (failed: RecordedCall[]): string[] => [
  ...new Set(failed.map((call) => call.failure ?? "")),
]

const label = (call: RecordedCall): string => `#${call.index} ${call.endpoint}`

export const sectionHeading = (title: string): string => `== ${title}`

const section = (title: string, body: string[]): string[] => ["", sectionHeading(title), ...body]

const failures = (calls: RecordedCall[]): string[] => {
  const failed = calls.filter(hasFailed)
  return failed.length === 0
    ? []
    : section(
        "failures",
        failed.map((call) => `${label(call)}: ${call.failure}`)
      )
}

const requests = (calls: RecordedCall[]): string[] =>
  section(
    "requests",
    calls.flatMap((call) => [`-- request ${label(call)}`, prettyJson(call.request)])
  )

const replies = (calls: RecordedCall[]): string[] =>
  section(
    "replies",
    calls.length === 0
      ? ["(no calls were made)"]
      : calls.flatMap((call) => [`-- reply ${label(call)}`, ...replyLines(call)])
  )

const replyLines = (call: RecordedCall): string[] => [
  ...(call.reply !== undefined ? [call.reply] : []),
  ...(call.failure !== undefined ? [`(failed: ${call.failure})`] : []),
]

const constructed = (report: RunReport): string[] =>
  section(
    report.agent.constructedLabel,
    report.constructed === undefined
      ? [`(nothing was constructed)`]
      : [JSON.stringify(report.constructed, null, 2)]
  )

const prettyJson = (raw: string): string => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
