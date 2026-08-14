export type ImportStatus =
  | "pending"
  | "reading"
  | "processing"
  | "embedding"
  | "classifying"
  | "regions"
  | "completed"
  | "incomplete"
  | "unsupported"
  | "error"

export interface ImportFile {
  id: string
  name: string
  size: number
  status: ImportStatus
  error?: string
  finalPath?: string
}

export interface ImportProgress {
  total: number
  completed: number
  incomplete: number
  failed: number
  unsupported: number
  processed: number
}
