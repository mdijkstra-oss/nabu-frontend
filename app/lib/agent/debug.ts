export const readDebugOption = <T>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback
  try {
    const stored = localStorage.getItem("nabu-debug-options")
    return stored ? (JSON.parse(stored)[key] ?? fallback) : fallback
  } catch {
    return fallback
  }
}

export const writeDebugOption = (key: string, value: unknown): void => {
  if (typeof window === "undefined") return
  try {
    const stored = localStorage.getItem("nabu-debug-options")
    const options = stored ? JSON.parse(stored) : {}
    localStorage.setItem("nabu-debug-options", JSON.stringify({ ...options, [key]: value }))
  } catch (_) {
    void _
  }
}
