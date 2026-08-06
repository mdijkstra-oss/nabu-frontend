// An unset variable and one set to nothing both mean nothing was chosen. A build
// arg declared but never passed arrives as the empty string, and taking that
// literally builds requests against `http:///queries/projects`.
export const getEnv = (key: string, fallback: string): string =>
  (import.meta.env[key] as string | undefined) || fallback
