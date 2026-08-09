const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => typeof v === "string")

const readE2eOverrides = (): Record<string, string> => {
  if (typeof localStorage === "undefined") return {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem("nabu-e2e-env") ?? "null")
    return isStringRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

// E2e builds can repoint values otherwise baked at build time; read once per
// page load. The literal env read keeps the branch statically dead without
// VITE_E2E, so the override code never enters production bundles.
const e2eOverrides: Record<string, string> = import.meta.env.VITE_E2E ? readE2eOverrides() : {}

// An unset variable and one set to nothing both mean nothing was chosen. A build
// arg declared but never passed arrives as the empty string, and taking that
// literally builds requests against `http:///queries/projects`.
export const getEnv = (key: string, fallback: string): string =>
  e2eOverrides[key] || (import.meta.env[key] as string | undefined) || fallback
