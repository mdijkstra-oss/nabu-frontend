import { getApiUrl } from "../env"
import type { Command, CommandResult } from "./types"

interface ErrorResponse {
  error: string
}

const parseErrorBody = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ErrorResponse
    return body.error || response.statusText
  } catch {
    return response.statusText
  }
}

export const sendCommand = async (projectId: string, command: Command): Promise<CommandResult> => {
  const url = getApiUrl(`/commands/${projectId}`)

  try {
    // const compressed = await gzipBody(JSON.stringify(command))
    // const response = await fetch(url, {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    //   body: compressed,
    // })

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    })

    if (!response.ok) {
      const error = await parseErrorBody(response)
      return { ok: false, error }
    }

    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error"
    return { ok: false, error: message }
  }
}
