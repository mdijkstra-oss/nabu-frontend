import { indexProseSentences, proseOf } from "~/lib/text/halo"
import { cutUnits } from "~/lib/cutting/units"
import type { ScanUnit } from "~/lib/regions/detect/types"
import type { FileStore } from "~/lib/files/store"

export interface ScannedDocument {
  file: string
  raw: string
  sentences: string[]
  units: ScanUnit[]
}

export const onlyFileOf = (files: FileStore): { file: string; raw: string } => {
  const [file] = Object.keys(files)
  return { file, raw: files[file] }
}

export const scanDocument = (file: string, raw: string): ScannedDocument => {
  const prose = proseOf(raw)
  const rows = indexProseSentences(prose)
  return { file, raw, sentences: rows.map((row) => row.text), units: cutUnits(prose, rows) }
}
