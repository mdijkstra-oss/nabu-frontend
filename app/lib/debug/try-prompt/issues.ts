import type { z } from "zod"

export const describeIssues = (
  error: z.ZodError,
  nameOf: (path: PropertyKey[]) => string
): string[] => error.issues.map((issue) => `${nameOf(issue.path)}: ${issue.message}`)
