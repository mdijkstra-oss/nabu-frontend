import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { BLOCK_COLORS } from "~/ui/theme/colors"
import { ICON_NAMES } from "~/ui/theme/icons"
import { REGION_KIND_IDS, getKind, parseKindRegistry, regionKinds } from "./registry"

const KINDS_DIR = join(process.cwd(), "app/domain/regions/kinds")

const valid = {
  id: "speaker",
  rules: "prose that says what a speaker is",
  icon: "mic",
  color: "indigo",
  valueType: "string",
}

describe("shipped kinds", () => {
  it.each(regionKinds())("$id carries a whole descriptor", (kind) => {
    expect(BLOCK_COLORS).toContain(kind.color)
    expect(ICON_NAMES as readonly string[]).toContain(kind.icon)
    expect(kind.rules.trim().length).toBeGreaterThan(0)
    expect(["string", "datetime"]).toContain(kind.valueType)
  })

  it.each(regionKinds())("$id inlines its own folder's rules.md", (kind) => {
    const onDisk = readFileSync(join(KINDS_DIR, kind.id, "rules.md"), "utf8")
    expect(kind.rules).toBe(onDisk)
  })

  it("declares one kind per folder", () => {
    const folders = readdirSync(KINDS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    expect([...REGION_KIND_IDS].sort()).toEqual(folders)
  })

  it("lists ids in declaration order", () => {
    expect(REGION_KIND_IDS).toEqual(regionKinds().map((k) => k.id))
  })

  it("resolves speaker as a list-backed kind", () => {
    const speaker = getKind("speaker")
    expect(speaker?.valueType).toBe("string")
    expect(speaker?.icon).toBe("mic")
    expect(speaker?.color).toBe("indigo")
  })

  it("yields nothing for an unregistered id", () => {
    expect(getKind("weather")).toBeUndefined()
  })
})

describe("parse", () => {
  it.each([
    ["blank rules", { ...valid, rules: "   \n " }, "rules"],
    ["a colour with no CSS variable", { ...valid, color: "burgundy" }, "color"],
    ["an icon outside ICON_NAMES", { ...valid, icon: "megaphone-of-truth" }, "icon"],
    ["a value type with no reducer", { ...valid, valueType: "duration" }, "valueType"],
    ["an id that is not a lowercase word", { ...valid, id: "Speaker Name" }, "id"],
  ])("rejects %s, naming the kind and the field", (_case, entry, field) => {
    expect(() => parseKindRegistry([entry])).toThrow(new RegExp(`${entry.id}.*${field}`))
  })

  it("rejects two kinds sharing a colour", () => {
    const second = { ...valid, id: "date", valueType: "datetime", icon: "calendar-days" }
    expect(() => parseKindRegistry([valid, second])).toThrow(/date.*duplicate color/)
  })

  it("rejects two kinds sharing an id", () => {
    expect(() => parseKindRegistry([valid, { ...valid, color: "amber" }])).toThrow(
      /speaker.*duplicate id/
    )
  })

  it("accepts a registry the shipped table has never heard of", () => {
    const parsed = parseKindRegistry([{ ...valid, id: "weather", color: "teal" }])
    expect(parsed.map((k) => k.id)).toEqual(["weather"])
  })
})

const IMPORT_RE = /from\s+"([^"]+)"/g

const resolveImport = (specifier: string, fromFile: string): string | null => {
  if (specifier.startsWith("~/")) return join(process.cwd(), "app", specifier.slice(2))
  if (specifier.startsWith(".")) return join(dirname(fromFile), specifier)
  return null
}

const readSource = (path: string): string | null => {
  for (const candidate of [path, `${path}.ts`, `${path}.tsx`, join(path, "index.ts")]) {
    try {
      return readFileSync(candidate, "utf8")
    } catch {
      continue
    }
  }
  return null
}

const reachableFrom = (entry: string): Set<string> => {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    const source = readSource(file)
    if (source === null) continue
    for (const [, specifier] of source.matchAll(IMPORT_RE)) {
      const resolved = resolveImport(specifier, file)
      if (resolved) queue.push(resolved)
      else seen.add(specifier)
    }
  }
  return seen
}

// The five consumers import kinds; none of them renders, writes a file or calls the
// gateway, so the registry may not drag any of that in behind it.
describe("isolation", () => {
  const reachable = [...reachableFrom(join(process.cwd(), "app/lib/regions/kinds/registry.ts"))]

  it.each(["files/store", "agent/client", "react", "lucide-react", "prosemirror"])(
    "never reaches %s",
    (forbidden) => {
      expect(reachable.filter((m) => m.includes(forbidden))).toEqual([])
    }
  )

  it("reaches only zod, the colour and icon lists, and the kind folders", () => {
    const external = reachable.filter((m) => !m.startsWith("/"))
    expect(external).toEqual(["zod"])
  })
})
