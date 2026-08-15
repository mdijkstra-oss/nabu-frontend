import type { z } from "zod"
import type { FileStore } from "~/lib/files/store"

export type ExtrasSchema = z.ZodObject<z.ZodRawShape>

export interface RunInput<Extras> {
  files: FileStore
  extras: Extras
}

export interface DebugAgent<Schema extends ExtrasSchema = ExtrasSchema> {
  name: string
  summary: string
  input: "file" | "directory"
  extras: Schema
  constructedLabel: string
  run: (input: RunInput<z.output<Schema>>) => Promise<unknown>
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UsageError"
  }
}

export const defineAgent = <Schema extends ExtrasSchema>(agent: DebugAgent<Schema>): DebugAgent =>
  agent as unknown as DebugAgent

export interface FlagMeta {
  [key: string]: unknown
  placeholder?: string
  description?: string
}
