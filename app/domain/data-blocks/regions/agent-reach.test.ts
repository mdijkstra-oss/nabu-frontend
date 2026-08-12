import { describe, it, expect } from "vitest"
import { blockTools } from "~/lib/agent/tools/block-tools/register"
import { getBlockSchemaDefinitions } from "~/lib/data-blocks/registry"
import { getBlock } from "~/lib/data-blocks/query"
import { normalizeAsStored } from "~/lib/files/store"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"

const LANGUAGE = "json-regions"

// Regions are derived output. An agent that can write them can fabricate provenance a
// researcher will read as detection, so there is no verb rather than a verb that refuses.
describe("the agent's reach", () => {
  it("generates no tool of any verb for json-regions", () => {
    expect(blockTools.filter((t) => t.name.includes("regions"))).toEqual([])
  })

  it("names the block in the system prompt with no writable property", () => {
    const definition = getBlockSchemaDefinitions().find((d) => d.language === LANGUAGE)
    const schema = definition?.jsonSchema as { properties?: Record<string, unknown> }
    expect(definition).toBeDefined()
    expect(Object.keys(schema.properties ?? {})).toEqual([])
  })
})

describe("a corpus that has never been scanned", () => {
  const PLAIN = "Rutte opened the meeting. He said the budget was settled.\n"

  it("renders, saves and reads exactly as it did before the feature existed", () => {
    expect(normalizeAsStored(PLAIN)).toBe(PLAIN)
    expect(getBlock(PLAIN, LANGUAGE, AnnotationsBlockSchema)).toBeNull()
  })

  it("carries no decoration on a block whose document holds no regions", () => {
    const raw = `${PLAIN}\n\`\`\`json-annotations\n{"annotations":[{"text":"the budget","reason":"a test fixture","color":"amber"}]}\n\`\`\`\n`
    const parsed = getBlock(raw, "json-annotations", AnnotationsBlockSchema)
    expect(parsed?.annotations[0]).not.toHaveProperty("inferred_meta")
  })
})
