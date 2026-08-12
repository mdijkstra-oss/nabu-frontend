import { describe, it, expect } from "vitest"
import { regionKinds } from "./kinds/registry"
import { sweepUnregisteredKinds } from "./boot-sweep"
import type { RegionsBlock } from "~/domain/data-blocks/regions/schema"

const REMOVED_KIND_ROW = {
  kind: "topic",
  parsed: { type: "string", value: "budget" },
  quote: "the budget",
  hitSentence: 0,
  startSentence: 0,
  endSentence: 1,
  rangeHash: "h",
}

const document = (block: unknown): string =>
  [
    "Rutte opened the meeting. He said the budget was settled.",
    "",
    "```json-regions",
    JSON.stringify(block),
    "```",
    "",
  ].join("\n")

// spec.md R7 — "When a kind is no longer registered, then its regions are removed from
// every document at boot." Removing a kind in production removes its id from
// REGION_KIND_IDS as well, which is what the stored row's `kind` enum is built from.
describe("the boot sweep, run against the registry that ships", () => {
  it("removes a no-longer-registered kind's regions from a document that carries them", () => {
    const files: Record<string, string> = {
      "interview.md": document({ regions: [REMOVED_KIND_ROW] }),
    }
    const writes: [string, RegionsBlock][] = []

    sweepUnregisteredKinds({
      getFiles: () => files,
      getKinds: regionKinds,
      writeRegions: (path, next) => {
        writes.push([path, next])
        files[path] = document(next)
        return "written"
      },
    })

    expect(files["interview.md"]).not.toContain("topic")
  })
})
