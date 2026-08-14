import { isMarkdownFile } from "~/lib/import/read"
import { STAGE_ORDER, type EngineEvent, type EngineStage } from "~/lib/engine/types"
import type { ImportFile, ImportProgress, ImportStatus } from "~/lib/import/types"

export interface DroppedFile {
  name: string
  size: number
}

export interface ImportRows {
  rows: Record<string, ImportFile>
  rowIdByPath: Record<string, string>
  stageOutcomes: Record<string, StageOutcomes>
}

export const emptyImportRows: ImportRows = {
  rows: {},
  rowIdByPath: {},
  stageOutcomes: {},
}

export const addRows = (state: ImportRows, dropped: DroppedFile[]): ImportRows => {
  const added = dropped.filter((file) => !state.rows[file.name])
  if (added.length === 0) return state
  const rows = { ...state.rows }
  for (const file of added) rows[file.name] = newRow(file)
  return { ...state, rows }
}

export const applyImportStatus = (
  state: ImportRows,
  id: string,
  status: ImportStatus,
  extra?: Partial<ImportFile>
): ImportRows => {
  const row = state.rows[id]
  if (!row) return state
  const rows = {
    ...state.rows,
    [id]: {
      ...row,
      status,
      ...(extra?.error !== undefined && { error: extra.error }),
      ...(extra?.finalPath !== undefined && { finalPath: extra.finalPath }),
    },
  }
  const rowIdByPath = extra?.finalPath
    ? { ...state.rowIdByPath, [extra.finalPath]: id }
    : state.rowIdByPath
  return { ...state, rows, rowIdByPath }
}

export const applyEngineEvent = (state: ImportRows, event: EngineEvent): ImportRows => {
  const id = state.rowIdByPath[event.file]
  if (!id) return state
  const row = state.rows[id]
  if (!row || isFrozen(row.status)) return state

  const stageOutcomes = withRecordedOutcome(state.stageOutcomes, id, event)
  const next = nextRow(row, stageOutcomes[id] ?? {}, event)
  if (next === row && stageOutcomes === state.stageOutcomes) return state
  return {
    ...state,
    rows: next === row ? state.rows : { ...state.rows, [id]: next },
    stageOutcomes,
  }
}

export const deriveProgress = (files: ImportFile[]): ImportProgress => {
  const count = (status: ImportStatus): number =>
    files.filter((file) => file.status === status).length
  const completed = count("completed")
  const incomplete = count("incomplete")
  const failed = count("error")
  const unsupported = count("unsupported")
  return {
    total: files.length,
    completed,
    incomplete,
    failed,
    unsupported,
    processed: completed + incomplete + failed + unsupported,
  }
}

interface StageOutcome {
  settled: boolean
  error?: string
}

type StageOutcomes = Partial<Record<EngineStage, StageOutcome>>

const stageStatuses: Record<EngineStage, ImportStatus> = {
  embed: "embedding",
  classify: "classifying",
  regions: "regions",
}

const frozenStatuses: ImportStatus[] = ["completed", "error", "unsupported"]

const isFrozen = (status: ImportStatus): boolean => frozenStatuses.includes(status)

const newRow = (file: DroppedFile): ImportFile => ({
  id: file.name,
  name: file.name,
  size: file.size,
  status: isMarkdownFile(file.name) ? "pending" : "unsupported",
})

const withRecordedOutcome = (
  all: Record<string, StageOutcomes>,
  id: string,
  event: EngineEvent
): Record<string, StageOutcomes> => {
  if (event.status !== "settled" && event.status !== "failed") return all
  const outcome: StageOutcome =
    event.status === "settled" ? { settled: true } : { settled: false, error: event.error }
  const recorded = all[id]?.[event.stage]
  if (recorded && recorded.settled === outcome.settled && recorded.error === outcome.error) {
    return all
  }
  return { ...all, [id]: { ...all[id], [event.stage]: outcome } }
}

const nextRow = (row: ImportFile, outcomes: StageOutcomes, event: EngineEvent): ImportFile => {
  if (STAGE_ORDER.every((stage) => outcomes[stage])) return terminatedRow(row, outcomes)
  if (event.status === "working") return { ...row, status: stageStatuses[event.stage] }
  return row
}

const isFailure = (outcome: StageOutcome | undefined): outcome is StageOutcome =>
  outcome !== undefined && !outcome.settled

const terminatedRow = (row: ImportFile, outcomes: StageOutcomes): ImportFile => {
  const failures = STAGE_ORDER.map((stage) => outcomes[stage]).filter(isFailure)
  const status: ImportStatus = failures.length === 0 ? "completed" : "incomplete"
  const error = failures[0]?.error
  if (row.status === status && row.error === error) return row
  return { ...row, status, error }
}
