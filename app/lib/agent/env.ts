import { getEnv } from "~/lib/utils/env"
import { getProjectId } from "~/lib/files/store"

export const getLlmHost = (): string => getEnv("VITE_LLM_HOST", "http://localhost:8081")

export const getLlmUrl = (path: string): string => `${getLlmHost()}${path}`

const sessionId = crypto.randomUUID()

export const getLlmHeaders = (): HeadersInit => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Session-ID": sessionId,
  }
  const projectId = getProjectId()
  if (projectId) headers["X-Project-ID"] = projectId
  return headers
}
