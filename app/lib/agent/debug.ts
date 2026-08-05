export const readDebugOption = <T>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback
  try {
    const stored = localStorage.getItem("nabu-debug-options")
    return stored ? (JSON.parse(stored)[key] ?? fallback) : fallback
  } catch {
    return fallback
  }
}
