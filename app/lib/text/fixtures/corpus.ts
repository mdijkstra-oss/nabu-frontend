import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// The sample documents the chunking report reads, which are also the property-test corpus:
// a document added to explore a chunking question becomes a case here without being copied.
const CORPUS_DIR = join(process.cwd(), "scripts/fixtures/chunking")

export interface CorpusDocument {
  name: string
  raw: string
}

export const readCorpusDocument = (name: string): string =>
  readFileSync(join(CORPUS_DIR, name), "utf8")

export const readCorpus = (): CorpusDocument[] =>
  readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ name, raw: readCorpusDocument(name) }))
