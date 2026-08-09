export const PREFERENCES_FILE = "preferences.md"
export const SETTINGS_FILE = "settings.hidden.md"

const PROTECTED_FILES = new Set([PREFERENCES_FILE, SETTINGS_FILE])

export const isProtectedFile = (path: string): boolean => PROTECTED_FILES.has(path)

export const isHiddenFile = (path: string): boolean => path.includes(".hidden.")

export const COMPANION_SUFFIX = ".embeddings.hidden.md"
export const isCompanionFile = (path: string): boolean => path.endsWith(COMPANION_SUFFIX)
export const companionFilename = (source: string): string =>
  source.replace(/\.md$/, COMPANION_SUFFIX)

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

// Verbatim, not display-cased: an unresolvable filename is a visible
// hallucination and must stay recognizable as what the model wrote. The
// file:// link marks it so the renderer can style it as missing, unlinked.
export const markMissingFile = (id: string): string | null =>
  id.endsWith(".md") ? `[${id}](file://${id})` : null

const UNTITLED_BASE = "untitled"

export const nextAvailableFilename = (desired: string, existingNames: Iterable<string>): string => {
  const names = new Set(existingNames)
  if (!names.has(desired)) return desired
  const base = desired.replace(/\.md$/, "")
  let counter = 2
  while (names.has(`${base}-${counter}.md`)) counter++
  return `${base}-${counter}.md`
}

export const nextUntitledFilename = (existingNames: Iterable<string>): string =>
  nextAvailableFilename(`${UNTITLED_BASE}.md`, existingNames)

// Inverse of toDisplayName up to case: spaces become the underscores toDisplayName
// shows as spaces, so a committed title re-displays as it was typed.
export const displayNameToFilename = (display: string): string => {
  const flat = display.trim().replace(/\s+/g, " ").replace(/\.md$/i, "")
  return flat === "" ? `${UNTITLED_BASE}.md` : normalizeFilename(`${flat}.md`)
}

// null: nothing to rename — the title already names this file, or the only free
// variant of the desired name is the current name itself.
export const renameTargetFor = (
  current: string,
  display: string,
  existingNames: Iterable<string>
): string | null => {
  const others = new Set(existingNames)
  others.delete(current)
  const target = nextAvailableFilename(displayNameToFilename(display), others)
  return target === current ? null : target
}
