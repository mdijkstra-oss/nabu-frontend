import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import type { z } from "zod"
import { FilterResponseSchema } from "~/lib/search/verdict"
import { ScoutFilterResponse } from "~/lib/agent/tools/scout-filter/def"
import { buildFindSchema, markSchema } from "~/lib/regions/detect/schema"

// The prompt shows an example, the schema is the definition; an example that
// drifts from the schema is the contract breaking in documentation form. The
// prompts live in the sibling repository, so this suite runs only where that
// checkout exists.
const PROMPTS_CONFIG = resolve(__dirname, "../../../../nabu-prompts/config")

const exampleJsonIn = (promptPath: string): unknown => {
  const text = readFileSync(resolve(PROMPTS_CONFIG, promptPath), "utf8")
  const fenced = /```json\n([\s\S]*?)```/.exec(text)
  if (!fenced) throw new Error(`no \`\`\`json example in ${promptPath}`)
  return JSON.parse(fenced[1])
}

const cases: { prompt: string; schema: z.ZodType }[] = [
  { prompt: "semantic-filter/semantic-filter.md", schema: FilterResponseSchema },
  { prompt: "scout-filter/scout-filter.md", schema: ScoutFilterResponse },
  { prompt: "region-finder/region-finder.md", schema: buildFindSchema("string") },
  { prompt: "region-marker/region-marker.md", schema: markSchema },
]

// The two deep-analysis prompts describe their shape with union notation
// ("keep" | "remove") rather than a JSON literal, so there is nothing to parse.
describe.skipIf(!existsSync(PROMPTS_CONFIG))("prompt example responses", () => {
  it.each(cases)("$prompt example parses against the frontend schema", ({ prompt, schema }) => {
    const parsed = schema.safeParse(exampleJsonIn(prompt))
    expect(parsed.error?.message ?? "").toBe("")
    expect(parsed.success).toBe(true)
  })
})
