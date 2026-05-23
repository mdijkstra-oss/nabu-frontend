export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === "AbortError"

export const errorMessage = (e: unknown): string => {
  if (isAbortError(e)) return "Canceled by user"
  return e instanceof Error ? e.message : String(e)
}
