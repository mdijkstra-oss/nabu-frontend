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

// WHY every rule here: the server stores one flat directory and rejects the whole
// write for a name outside a-z0-9 - _ . ( ) ' , or one starting with a dot or
// containing "..". A rejected write is a file that exists in this tab and nowhere
// else, so the name is made storable before it is used rather than after it fails.

// Letters that carry no decomposition, so stripping combining marks leaves them.
const TRANSLITERATIONS: Record<string, string> = {
  æ: "ae",
  œ: "oe",
  ø: "o",
  ß: "ss",
  đ: "d",
  ð: "d",
  ł: "l",
  þ: "th",
}

const COMBINING_MARKS = /[\u0300-\u036f]/g
const LEADING_TRAVERSAL = /^[./]+/
const UNSTORABLE = /[^a-z0-9\-_.(),']/g

const transliterate = (name: string): string =>
  name.replace(/[æœøßđðłþ]/g, (letter) => TRANSLITERATIONS[letter])

export const normalizeFilename = (name: string): string => {
  const latin = transliterate(name.toLowerCase()).normalize("NFD").replace(COMBINING_MARKS, "")
  // A leading "../" goes before substitution, or it survives as the "_._" it would
  // become. A separator further in joins instead, because a dropped folder can carry
  // the same leaf name from two directories.
  const rooted = latin.replace(LEADING_TRAVERSAL, "").replace(UNSTORABLE, "_")
  const flattened = rooted.replace(/\.{2,}/g, ".").replace(/^\.+/, "")
  return flattened === "" ? "untitled.md" : flattened
}

export const toDisplayName = (filename: string): string =>
  filename
    .replace(/\.hidden\.md$/, ".md")
    .replace(/\.md$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())

export const boldMissingFile = (id: string): string | null =>
  id.endsWith(".md") ? `**${toDisplayName(id)}**` : null

const UNTITLED_BASE = "untitled"

export const nextUntitledFilename = (existingNames: Iterable<string>): string => {
  const names = new Set(existingNames)
  if (!names.has(`${UNTITLED_BASE}.md`)) return `${UNTITLED_BASE}.md`
  let counter = 2
  while (names.has(`${UNTITLED_BASE}-${counter}.md`)) counter++
  return `${UNTITLED_BASE}-${counter}.md`
}
