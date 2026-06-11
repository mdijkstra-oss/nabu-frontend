export type FilterJudgment = "keep" | "remove" | "missing"
export type FilterOutcome = "keep" | "remove" | "contested"
export type AdjudVerdict = "keep" | "reject" | "inconsistent"

export interface FilterVote {
  modelIdx: number
  judgment: FilterJudgment
  reason: string
}

export interface FilterEntry {
  code: string
  start: number
  end: number
  text: string
  votes: FilterVote[]
  outcome: FilterOutcome
}

export interface AdjudEntry {
  code: string
  start: number
  end: number
  text: string
  verdict: AdjudVerdict
  reason: string
}

export interface FindInfo {
  candidates: number
  files: string[]
  limit: number
  title?: string
}

export interface DimTrace {
  dim: string
  target: string
  voterCount: number
  find: FindInfo
  filter: FilterEntry[]
  adjud: AdjudEntry[]
}

export interface Tracer {
  setTarget(target: string): void
  setVoterCount(count: number): void
  setFind(dim: string, info: FindInfo): void
  pushFilter(dim: string, entry: FilterEntry): void
  pushAdjud(dim: string, entry: AdjudEntry): void
  snapshot(): DimTrace[]
  flush(): void
}

export const formatDimTrace = (t: DimTrace): string => {
  const filesArg = `[${t.find.files.join(", ")}]`
  const titlePart = t.find.title ? ` title=${t.find.title}` : ""
  const lines: string[] = [
    `[apply-deep dim=${t.dim}${titlePart}] target=${t.target}`,
    `find → ${t.find.candidates} candidates  (limit=${t.find.limit}, files=${filesArg})`,
    "",
    `filter (${t.voterCount} voters)`,
  ]
  const filterSorted = sortBySpan(t.filter)
  if (filterSorted.length === 0) lines.push("  (no entries reached filter)")
  else for (const e of filterSorted) lines.push(formatFilterEntry(e))
  lines.push("")
  const adjudSorted = sortBySpan(t.adjud)
  const entryWord = adjudSorted.length === 1 ? "entry" : "entries"
  lines.push(`adjudicate (${adjudSorted.length} ${entryWord})`)
  if (adjudSorted.length === 0) lines.push("  (none)")
  else for (const e of adjudSorted) lines.push(formatAdjudEntry(e))
  return lines.join("\n")
}

export const createTracer = (): Tracer => {
  const dims = new Map<string, DimTrace>()
  let target = "unknown"
  let voterCount = 0

  const ensure = (dim: string): DimTrace => {
    let t = dims.get(dim)
    if (t) return t
    t = {
      dim,
      target,
      voterCount,
      find: { candidates: 0, files: [], limit: 0 },
      filter: [],
      adjud: [],
    }
    dims.set(dim, t)
    return t
  }

  return {
    setTarget(t) {
      target = t
      for (const d of dims.values()) d.target = t
    },
    setVoterCount(count) {
      voterCount = count
      for (const d of dims.values()) d.voterCount = count
    },
    setFind(dim, info) {
      const t = ensure(dim)
      t.find = info
    },
    pushFilter(dim, entry) {
      ensure(dim).filter.push(entry)
    },
    pushAdjud(dim, entry) {
      ensure(dim).adjud.push(entry)
    },
    snapshot() {
      return [...dims.values()].sort((a, b) => a.dim.localeCompare(b.dim))
    },
    flush() {
      const ordered = [...dims.values()].sort((a, b) => a.dim.localeCompare(b.dim))
      for (const t of ordered) console.debug(formatDimTrace(t))
    },
  }
}

const sortBySpan = <T extends { start: number; end: number; code: string }>(entries: T[]): T[] =>
  [...entries].sort((a, b) => a.start - b.start || a.end - b.end || a.code.localeCompare(b.code))

const voteMark = (j: FilterJudgment): string => {
  if (j === "keep") return "✓"
  if (j === "remove") return "✗"
  return "·"
}

const outcomeLabel = (e: FilterEntry): string => {
  const keeps = e.votes.filter((v) => v.judgment === "keep").length
  const total = e.votes.length
  if (e.outcome === "keep") return `passed ${keeps}/${total}`
  if (e.outcome === "remove") return `dropped ${keeps}/${total}`
  return `split → adjudicate`
}

const verdictLabel = (v: AdjudVerdict): string => {
  if (v === "keep") return "confirmed"
  if (v === "reject") return "rejected"
  return "inconsistent"
}

const formatFilterEntry = (e: FilterEntry): string => {
  const head = `  ▸ [${e.code}] s${e.start}-${e.end}`
  const text = `      text: "${e.text}"`
  const votes = e.votes
    .map((v) => `      v${v.modelIdx + 1} ${voteMark(v.judgment)} "${v.reason}"`)
    .join("\n")
  const outcome = `      → ${outcomeLabel(e)}`
  return [head, text, votes, outcome].join("\n")
}

const formatAdjudEntry = (e: AdjudEntry): string => {
  const head = `  ▸ [${e.code}] s${e.start}-${e.end} → ${verdictLabel(e.verdict)}`
  const text = `      text: "${e.text}"`
  const reason = `      "${e.reason}"`
  return [head, text, reason].join("\n")
}
