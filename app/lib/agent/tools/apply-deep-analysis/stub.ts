import type { Target } from "./def"
import type { Envelope } from "./envelope"
import type { ContentResolver } from "./messages"
import { STUB_ANNOTATIONS } from "./stub-fixture"
import { getEnv } from "~/lib/utils/env"
import { think, STARTING, READING_FRAMEWORK, FINDING, CONSENSUS, FILTERING } from "./thoughts"

const TOGGLE_KEY = "nabu-stub-deep-analysis"

const toggledInBrowser = (): boolean => {
  if (typeof localStorage === "undefined") return false
  try {
    return localStorage.getItem(TOGGLE_KEY) === "1"
  } catch {
    return false
  }
}

// Replays a fixture in place of the model calls, so a coding pass produces the
// same annotations every run without a gateway, a database or an embeddings
// service. Turn it on with VITE_STUB_DEEP_ANALYSIS=1 at build time, or with
// localStorage.setItem("nabu-stub-deep-analysis", "1") in a running page.
export const isStubEnabled = (): boolean =>
  getEnv("VITE_STUB_DEEP_ANALYSIS", "") !== "" || toggledInBrowser()

// The live pass spends its time on network calls. Without them the tool would
// return before the progress line rendered, which reads as nothing happening.
const STEP_MS = 700

const STEPS = [STARTING, READING_FRAMEWORK, FINDING, CONSENSUS, FILTERING] as const

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const uniqueFiles = (targets: readonly Target[]): string[] => [
  ...new Set(targets.map((t) => t.path)),
]

const envelopeFor = (
  file: string,
  content: string,
  row: { code: string; text: string; reason: string },
  index: number
): Envelope | null => {
  const start = content.indexOf(row.text)
  if (start === -1) return null
  return {
    id: `stub-${file}-${index}`,
    code: row.code,
    file,
    fileCharStart: start,
    fileCharEnd: start + row.text.length,
    haloSentences: [],
    markedStart: 0,
    markedEnd: row.text.length,
    markedText: row.text,
    findVotes: [true, true],
    reason: row.reason,
  }
}

export interface Analysis {
  envelopes: Envelope[]
  errors: string[]
  error?: string
}

export const runStubAnalysis = async (
  targets: readonly Target[],
  analyzedCodes: ReadonlySet<string>,
  resolve: ContentResolver
): Promise<Analysis> => {
  for (const step of STEPS) {
    think(step)
    await pause(STEP_MS)
  }

  const files = new Set(uniqueFiles(targets))
  const envelopes: Envelope[] = []

  for (const file of files) {
    const content = resolve(file)
    if (content === undefined) continue
    const rows = STUB_ANNOTATIONS.filter((r) => r.file === file && analyzedCodes.has(r.code))
    rows.forEach((row, index) => {
      const envelope = envelopeFor(file, content, row, index)
      if (envelope) envelopes.push(envelope)
    })
  }

  return { envelopes, errors: [] }
}
