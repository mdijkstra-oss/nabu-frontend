export const PREFERENCES_FILE = "preferences.md"
export const SETTINGS_FILE = "settings.hidden.md"

const PROTECTED_FILES = new Set([PREFERENCES_FILE, SETTINGS_FILE])

export const isProtectedFile = (path: string): boolean => PROTECTED_FILES.has(path)

export const isHiddenFile = (path: string): boolean => path.includes(".hidden.")

export const COMPANION_SUFFIX = ".embeddings.hidden.md"
export const isCompanionFile = (path: string): boolean => path.endsWith(COMPANION_SUFFIX)

export const isMarkdownFile = (path: string): boolean => path.endsWith(".md")

export const GENERATED_SUFFIX = ".generated.hidden.md"
export const isGeneratedHiddenFile = (path: string): boolean => path.endsWith(GENERATED_SUFFIX)
export const stripGeneratedSuffix = (path: string): string =>
  path.endsWith(GENERATED_SUFFIX) ? path.slice(0, -GENERATED_SUFFIX.length) : path

export const normalizeFilename = (name: string): string => name.toLowerCase().replace(/ /g, "_")

export const toDisplayName = (filename: string): string =>
  filename
    .replace(/\.hidden\.md$/, ".md")
    .replace(/\.md$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())

export const boldMissingFile = (id: string): string | null =>
  id.endsWith(".md") ? `**${toDisplayName(id)}**` : null
