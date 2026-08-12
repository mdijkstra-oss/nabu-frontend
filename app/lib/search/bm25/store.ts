import MiniSearch from "minisearch"

export interface Bm25Doc {
  id: string
  hash: string
  file: string
  text: string
  chunkStart: number
  chunkEnd: number
  language: string
}

export interface Bm25Hit {
  id: string
  hash: string
  file: string
  chunkStart: number
  chunkEnd: number
  score: number
  text: string
}

// A chunk's hash is its content, and content-defined boundaries make two copies of the
// same passage hash identically — within a file or across two of them. The index needs an
// identity that survives that, or the second copy is dropped and never found.
export const bm25DocId = (file: string, chunkStart: number): string => `${file}\u0000${chunkStart}`

interface LanguageState {
  index: MiniSearch<Bm25Doc>
  docs: Map<string, Bm25Doc>
  ownership: Map<string, Set<string>>
}

const buildIndex = (): MiniSearch<Bm25Doc> =>
  new MiniSearch<Bm25Doc>({
    fields: ["text"],
    storeFields: ["file", "chunkStart", "chunkEnd"],
    idField: "id",
  })

const buildState = (): LanguageState => ({
  index: buildIndex(),
  docs: new Map(),
  ownership: new Map(),
})

const states = new Map<string, LanguageState>()

const getState = (language: string): LanguageState => {
  const existing = states.get(language)
  if (existing) return existing
  const fresh = buildState()
  states.set(language, fresh)
  return fresh
}

const getOwnedIds = (state: LanguageState, file: string): Set<string> => {
  const existing = state.ownership.get(file)
  if (existing) return existing
  const fresh = new Set<string>()
  state.ownership.set(file, fresh)
  return fresh
}

const discardIds = (state: LanguageState, ids: Iterable<string>): void => {
  for (const id of ids) {
    if (!state.docs.has(id)) continue
    state.index.discard(id)
    state.docs.delete(id)
  }
}

export const replaceFile = (language: string, file: string, docs: Bm25Doc[]): void => {
  const state = getState(language)
  const owned = getOwnedIds(state, file)
  discardIds(state, owned)
  owned.clear()

  for (const doc of docs) {
    if (state.docs.has(doc.id)) continue
    state.index.add(doc)
    state.docs.set(doc.id, doc)
    owned.add(doc.id)
  }

  if (owned.size === 0) state.ownership.delete(file)
}

export const removeFile = (language: string, file: string): void => {
  const state = states.get(language)
  if (!state) return
  const owned = state.ownership.get(file)
  if (!owned) return
  discardIds(state, owned)
  state.ownership.delete(file)
}

export const removeFileFromAllLanguages = (file: string): void => {
  for (const language of states.keys()) removeFile(language, file)
}

export interface QueryOptions {
  candidates?: Set<string>
}

export const queryBm25 = (
  language: string,
  text: string,
  limit: number,
  options: QueryOptions = {}
): Bm25Hit[] => {
  const state = states.get(language)
  if (!state) return []
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  const { candidates } = options
  if (candidates && candidates.size === 0) return []
  const filter = candidates
    ? (result: { id: string | number }) => candidates.has(String(result.id))
    : undefined
  const results = state.index.search(trimmed, { prefix: false, fuzzy: false, filter })
  const sliced = results.slice(0, limit)
  return sliced.flatMap((r): Bm25Hit[] => {
    const doc = state.docs.get(String(r.id))
    if (!doc) return []
    return [
      {
        id: doc.id,
        hash: doc.hash,
        file: doc.file,
        chunkStart: doc.chunkStart,
        chunkEnd: doc.chunkEnd,
        score: r.score,
        text: doc.text,
      },
    ]
  })
}

export const indexedLanguages = (): string[] => [...states.keys()]

export const ownedIdsForFile = (language: string, file: string): Set<string> =>
  states.get(language)?.ownership.get(file) ?? new Set()

export const languageStats = (): Record<string, { docs: number; files: number }> => {
  const out: Record<string, { docs: number; files: number }> = {}
  for (const [language, state] of states) {
    out[language] = { docs: state.docs.size, files: state.ownership.size }
  }
  return out
}

export const resetBm25 = (): void => {
  states.clear()
}
