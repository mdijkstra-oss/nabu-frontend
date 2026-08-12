import {
  BOUNDARY_MASK_BITS,
  BOUNDARY_WINDOW_CHARS,
  maskOfBits,
  UNIT_CEILING_CHARS,
  UNIT_FLOOR_CHARS,
} from "~/lib/cutting/constants"
import {
  boundaryTestForMask,
  cutUnits,
  verdictAt,
  type CutRule,
  type Unit,
} from "~/lib/cutting/units"
import { indexProseSentences, proseOf, type SentenceRow } from "~/lib/text/halo"
import { sharedCount } from "~/lib/utils/multiset"

export type CloseReason = "content test" | "ceiling" | "end of document"
export type WarningKind = "unclosed bracket" | "unpaired backtick" | "over ceiling"

export interface Distribution {
  count: number
  mean: number
  percentiles: number[] | null
}

export interface UnitReport {
  unit: Unit
  size: number
  reason: CloseReason
  suppressedGaps: number
}

export interface UnitSummary {
  sizes: Distribution
  closedBy: Record<CloseReason, number>
  suppressedGaps: number
}

export interface SegmentationWarning {
  sentence: number
  kind: WarningKind
  text: string
}

export interface DocumentAnalysis {
  name: string
  prose: string
  rows: SentenceRow[]
  units: UnitReport[]
  sentenceLengths: number[]
  warnings: SegmentationWarning[]
}

export interface MaskSweep {
  bits: number
  mask: number
  units: UnitReport[]
}

export interface StabilityProbe {
  insertAt: number
  original: number
  edited: number
  surviving: number
}

export interface InsertionPoints {
  top: number
  midpoint: number
}

export const PERCENTILES = [10, 50, 90, 99]
export const SWEEP_MASK_BITS = [2, 3, 4, 5, 6]
export const PROBE_SENTENCE = "A newly inserted sentence sits here. "

// What the report was run with. The script turns its flags into one of these, so a number
// printed in the header is the number the units below it were cut by.
export interface ReportSettings {
  maskBits: number
  window: number
  floor: number
  ceiling: number
}

export const DEFAULT_SETTINGS: ReportSettings = {
  maskBits: BOUNDARY_MASK_BITS,
  window: BOUNDARY_WINDOW_CHARS,
  floor: UNIT_FLOOR_CHARS,
  ceiling: UNIT_CEILING_CHARS,
}

export const ruleOf = (settings: ReportSettings): CutRule => ({
  isBoundary: boundaryTestForMask(maskOfBits(settings.maskBits), settings.window),
  floor: settings.floor,
  ceiling: settings.ceiling,
})

export const distributionOf = (values: readonly number[]): Distribution => {
  if (values.length === 0) return { count: 0, mean: 0, percentiles: null }
  const sorted = [...values].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    count: sorted.length,
    mean: total / sorted.length,
    percentiles: PERCENTILES.map((percentile) => nearestRank(sorted, percentile)),
  }
}

export const reportUnits = (
  prose: string,
  rows: readonly SentenceRow[],
  rule: CutRule = ruleOf(DEFAULT_SETTINGS)
): UnitReport[] =>
  cutUnits(prose, rows, rule).map((unit) => ({
    unit,
    size: unit.charEnd - unit.charStart,
    reason: closeReasonOf(prose, rows, unit, rule),
    suppressedGaps: countSuppressedGaps(prose, rows, unit, rule),
  }))

export const summarizeUnits = (units: readonly UnitReport[]): UnitSummary => ({
  sizes: distributionOf(units.map((report) => report.size)),
  closedBy: {
    "content test": countClosedBy(units, "content test"),
    ceiling: countClosedBy(units, "ceiling"),
    "end of document": countClosedBy(units, "end of document"),
  },
  suppressedGaps: units.reduce((sum, report) => sum + report.suppressedGaps, 0),
})

export const collectWarnings = (
  rows: readonly SentenceRow[],
  ceiling: number = UNIT_CEILING_CHARS
): SegmentationWarning[] =>
  rows.flatMap((row, index) =>
    warningKindsFor(row, ceiling).map((kind) => ({ sentence: index + 1, kind, text: row.text }))
  )

export const analyzeDocument = (
  name: string,
  rawFile: string,
  settings: ReportSettings = DEFAULT_SETTINGS
): DocumentAnalysis => {
  const prose = proseOf(rawFile)
  const rows = indexProseSentences(prose)
  return {
    name,
    prose,
    rows,
    units: reportUnits(prose, rows, ruleOf(settings)),
    sentenceLengths: rows.map((row) => row.end - row.start),
    warnings: collectWarnings(rows, settings.ceiling),
  }
}

export const sweepMasks = (
  documents: readonly DocumentAnalysis[],
  settings: ReportSettings = DEFAULT_SETTINGS,
  bitWidths: readonly number[] = SWEEP_MASK_BITS
): MaskSweep[] =>
  bitWidths.map((bits) => {
    const rule = ruleOf({ ...settings, maskBits: bits })
    return {
      bits,
      mask: maskOfBits(bits),
      units: documents.flatMap((doc) => reportUnits(doc.prose, doc.rows, rule)),
    }
  })

export const sharedHashCount = sharedCount<string>

export const probeStability = (
  prose: string,
  insertAt: number,
  rule: CutRule = ruleOf(DEFAULT_SETTINGS)
): StabilityProbe => {
  const before = unitHashesOf(prose, rule)
  const edited = prose.slice(0, insertAt) + PROBE_SENTENCE + prose.slice(insertAt)
  const after = unitHashesOf(edited, rule)
  return {
    insertAt,
    original: before.length,
    edited: after.length,
    surviving: sharedHashCount(before, after),
  }
}

export const insertionPoints = (document: DocumentAnalysis): InsertionPoints => ({
  top: document.units[0]?.unit.charStart ?? 0,
  midpoint: sentenceStartNearest(document.rows, document.prose.length / 2),
})

export const renderDocumentDump = (
  document: DocumentAnalysis,
  settings: ReportSettings = DEFAULT_SETTINGS
): string =>
  [
    `${document.name} — ${document.prose.length} chars · ${document.rows.length} sentences · ${document.units.length} units`,
    settingsLine(settings),
    ...document.units.map((report, index) => renderUnitBlock(document, report, index)),
    "",
  ].join("\n")

export const renderCorpusReport = (
  documents: readonly DocumentAnalysis[],
  settings: ReportSettings = DEFAULT_SETTINGS
): string =>
  [
    `Chunking report — ${documents.length} files`,
    settingsLine(settings),
    "",
    renderSentenceLengths(documents),
    renderUnitSizes(documents),
    renderMaskSweep(documents),
    renderStabilityProbe(documents),
    renderWarnings(documents),
  ].join("\n")

const RULE = "─".repeat(96)
const HASH_PREFIX_CHARS = 8
const WARNING_EXCERPT_CHARS = 70
const CORPUS_ROW_LABEL = "(corpus)"

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

const nearestRank = (sorted: readonly number[], percentile: number): number =>
  sorted[clamp(Math.ceil((percentile / 100) * sorted.length) - 1, 0, sorted.length - 1)]

const closeReasonOf = (
  prose: string,
  rows: readonly SentenceRow[],
  unit: Unit,
  rule: CutRule
): CloseReason => {
  if (unit.lastSentence === rows.length - 1) return "end of document"
  const verdict = verdictAt(prose, rows, unit.firstSentence, unit.lastSentence, rule)
  return verdict === "ceiling" ? "ceiling" : "content test"
}

// Every interior gap of a closed unit already failed the ceiling, so a gap the content
// test would have cut at is one the floor and only the floor held shut.
const countSuppressedGaps = (
  prose: string,
  rows: readonly SentenceRow[],
  unit: Unit,
  rule: CutRule
): number => {
  let suppressed = 0
  for (let index = unit.firstSentence; index < unit.lastSentence; index++) {
    if (verdictAt(prose, rows, unit.firstSentence, index, rule) !== "floor") continue
    if (rule.isBoundary(prose, rows[index].end)) suppressed++
  }
  return suppressed
}

const countClosedBy = (units: readonly UnitReport[], reason: CloseReason): number =>
  units.filter((report) => report.reason === reason).length

const occurrencesOf = (text: string, character: string): number => text.split(character).length - 1

const hasUnclosedBracket = (text: string): boolean =>
  occurrencesOf(text, "[") !== occurrencesOf(text, "]")

const hasUnpairedBacktick = (text: string): boolean => occurrencesOf(text, "`") % 2 !== 0

const warningKindsFor = (row: SentenceRow, ceiling: number): WarningKind[] => {
  const kinds: WarningKind[] = []
  if (hasUnclosedBracket(row.text)) kinds.push("unclosed bracket")
  if (hasUnpairedBacktick(row.text)) kinds.push("unpaired backtick")
  if (row.end - row.start > ceiling) kinds.push("over ceiling")
  return kinds
}

const unitHashesOf = (prose: string, rule: CutRule): string[] =>
  cutUnits(prose, indexProseSentences(prose), rule).map((unit) => unit.hash)

const sentenceStartNearest = (rows: readonly SentenceRow[], offset: number): number =>
  (rows.find((row) => row.start >= offset) ?? rows.at(-1))?.start ?? 0

const renderUnitBlock = (document: DocumentAnalysis, report: UnitReport, index: number): string => {
  const { unit } = report
  const header = [
    `UNIT ${index + 1}`,
    `sentences ${unit.firstSentence + 1}-${unit.lastSentence + 1}`,
    `${report.size} chars`,
    `hash ${unit.hash.slice(0, HASH_PREFIX_CHARS)}`,
    `closed by ${report.reason}`,
    `floor suppressed ${report.suppressedGaps} gaps`,
  ].join("  ·  ")
  const sentences = document.rows
    .slice(unit.firstSentence, unit.lastSentence + 1)
    .map((row, offset) => `[${unit.firstSentence + offset + 1}] ${row.text}`)
  return [RULE, header, RULE, ...sentences].join("\n")
}

const settingsLine = (settings: ReportSettings): string =>
  [
    `mask 0b${maskOfBits(settings.maskBits).toString(2)}`,
    `floor ${settings.floor}`,
    `ceiling ${settings.ceiling}`,
    `window ${settings.window}`,
  ].join(" · ")

const percentileHeaders = PERCENTILES.map((percentile) => `p${percentile}`)

const distributionHeaders = (countLabel: string): string[] => [
  countLabel,
  "mean",
  ...percentileHeaders,
]

const distributionCells = (distribution: Distribution): string[] => [
  String(distribution.count),
  String(Math.round(distribution.mean)),
  ...(distribution.percentiles?.map(String) ?? percentileHeaders.map(() => "—")),
]

const summaryHeaders = [
  ...distributionHeaders("units"),
  "content",
  "ceiling",
  "end",
  "content%",
  "suppressed",
]

const percentageOf = (part: number, whole: number): string =>
  whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`

const summaryCells = (summary: UnitSummary): string[] => [
  ...distributionCells(summary.sizes),
  String(summary.closedBy["content test"]),
  String(summary.closedBy.ceiling),
  String(summary.closedBy["end of document"]),
  percentageOf(summary.closedBy["content test"], summary.sizes.count),
  String(summary.suppressedGaps),
]

const isNumeric = (cell: string): boolean => /^[\d.%—]+$/.test(cell)

const formatTable = (headers: readonly string[], rows: readonly string[][]): string => {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length))
  )
  const alignRight = headers.map((_, column) => rows.every((row) => isNumeric(row[column])))
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) =>
        alignRight[column] ? cell.padStart(widths[column]) : cell.padEnd(widths[column])
      )
      .join("  ")
      .trimEnd()
  return [line(headers), ...rows.map(line)].join("\n")
}

const section = (title: string, body: string): string => `${title}\n${body}\n`

const renderSentenceLengths = (documents: readonly DocumentAnalysis[]): string =>
  section(
    "SENTENCE LENGTHS",
    formatTable(
      ["file", ...distributionHeaders("count")],
      [
        ...documents.map((doc) => [
          doc.name,
          ...distributionCells(distributionOf(doc.sentenceLengths)),
        ]),
        [
          CORPUS_ROW_LABEL,
          ...distributionCells(distributionOf(documents.flatMap((doc) => doc.sentenceLengths))),
        ],
      ]
    )
  )

const renderUnitSizes = (documents: readonly DocumentAnalysis[]): string =>
  section(
    "UNIT SIZES",
    formatTable(
      ["file", ...summaryHeaders],
      [
        ...documents.map((doc) => [doc.name, ...summaryCells(summarizeUnits(doc.units))]),
        [CORPUS_ROW_LABEL, ...summaryCells(summarizeUnits(documents.flatMap((doc) => doc.units)))],
      ]
    )
  )

const renderMaskSweep = (documents: readonly DocumentAnalysis[]): string =>
  section(
    "MASK SWEEP — the whole corpus re-cut at each width",
    formatTable(
      ["mask", ...summaryHeaders],
      sweepMasks(documents).map((sweep) => [
        `${sweep.bits} bits (0b${sweep.mask.toString(2)})`,
        ...summaryCells(summarizeUnits(sweep.units)),
      ])
    )
  )

const probeCells = (probe: StabilityProbe): string[] => [
  String(probe.edited),
  String(probe.surviving),
]

const renderStabilityProbe = (documents: readonly DocumentAnalysis[]): string =>
  section(
    "STABILITY PROBE — one sentence inserted, unit hashes surviving",
    formatTable(
      ["file", "units", "top: units", "top: survived", "mid: units", "mid: survived"],
      documents.map((doc) => {
        const points = insertionPoints(doc)
        return [
          doc.name,
          String(doc.units.length),
          ...probeCells(probeStability(doc.prose, points.top)),
          ...probeCells(probeStability(doc.prose, points.midpoint)),
        ]
      })
    )
  )

const excerptOf = (text: string): string =>
  text.length <= WARNING_EXCERPT_CHARS ? text : `${text.slice(0, WARNING_EXCERPT_CHARS)}…`

const renderWarnings = (documents: readonly DocumentAnalysis[]): string => {
  const rows = documents.flatMap((doc) =>
    doc.warnings.map((warning) => [
      doc.name,
      String(warning.sentence),
      warning.kind,
      excerptOf(warning.text.replace(/\s+/g, " ")),
    ])
  )
  return section(
    "SEGMENTATION WARNINGS",
    rows.length === 0 ? "none" : formatTable(["file", "sentence", "kind", "excerpt"], rows)
  )
}
