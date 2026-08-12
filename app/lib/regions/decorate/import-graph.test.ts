import { describe, it, expect } from "vitest"
import { readFileSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"

const APP = join(process.cwd(), "app")

const IMPORT = /^\s*(?:import|export)\s+(?:type\s+)?(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm

const TYPE_ONLY = /^\s*import\s+type\s/

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const resolveModule = (specifier: string, importer: string): string | null => {
  const base = specifier.startsWith("~/")
    ? join(APP, specifier.slice(2))
    : specifier.startsWith(".")
      ? join(dirname(importer), specifier)
      : null
  if (base === null) return null
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]
  return candidates.find(isFile) ?? null
}

const runtimeImportsOf = (file: string): string[] => {
  const source = readFileSync(file, "utf8")
  const resolved: string[] = []
  for (const match of source.matchAll(IMPORT)) {
    if (TYPE_ONLY.test(match[0])) continue
    const target = resolveModule(match[1], file)
    if (target) resolved.push(target)
  }
  return resolved
}

const shortestPath = (from: string, to: string): string[] | null => {
  const cameFrom = new Map<string, string | null>([[from, null]])
  const queue = [from]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const next of runtimeImportsOf(current)) {
      if (cameFrom.has(next)) continue
      cameFrom.set(next, current)
      if (next === to) {
        const path: string[] = []
        for (let step: string | null = next; step; step = cameFrom.get(step) ?? null) {
          path.push(relative(process.cwd(), step))
        }
        return path.reverse()
      }
      queue.push(next)
    }
  }
  return null
}

// Decoration hangs off the block-read path, which the file store itself reads through.
// A runtime edge back to the store closes a cycle whose symptom is a module-init
// ReferenceError in whichever entry point happens to load first.
describe("the block-read path", () => {
  it.each([
    ["the file store", "lib/files/store.ts"],
    ["the database", "domain/db/database.ts"],
  ])("never reaches %s", (_name, target) => {
    expect(shortestPath(join(APP, "lib/data-blocks/query.ts"), join(APP, target))).toBeNull()
  })
})
