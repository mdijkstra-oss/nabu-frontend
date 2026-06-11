import type { ValidationError } from "~/lib/data-blocks/validate"

export class FileCorruptionError extends Error {
  readonly path: string
  readonly errors: ValidationError[]

  constructor(path: string, errors: ValidationError[]) {
    const detail = errors
      .map((e) => `${e.block}${e.field ? "." + e.field : ""}: ${e.message}`)
      .join("; ")
    super(`Refusing to write corrupted file "${path}": ${detail}`)
    this.name = "FileCorruptionError"
    this.path = path
    this.errors = errors
  }
}
