import { describe, it, expect } from "vitest"
import { blockPatchTools } from "~/lib/agent/tools/block-tools/register"
import { getBlockConfig, getBlockSchemaDefinitions } from "~/lib/data-blocks/registry"
import { toBlockSchema } from "~/lib/data-blocks/json-schema"
import { deriveTypedOps } from "~/lib/data-blocks/typed-ops/derive"
import { INFERRED_META } from "./schema"

const configOf = (language: string) => {
  const config = getBlockConfig(language)
  if (!config) throw new Error(`no block config for ${language}`)
  return config
}

describe("the agent's view of a decorated block", () => {
  it("offers no patch operation naming the field", () => {
    const spec = deriveTypedOps("json-annotations", configOf("json-annotations"))
    const [annotations] = spec.arrayOps

    expect(JSON.stringify(spec.setFieldsSchema)).not.toContain(INFERRED_META)
    expect(JSON.stringify(annotations.itemSchema)).not.toContain(INFERRED_META)
    expect(JSON.stringify(annotations.partialItemSchema)).not.toContain(INFERRED_META)
  })

  it("names the field in no block tool", () => {
    expect(JSON.stringify(blockPatchTools)).not.toContain(INFERRED_META)
  })

  it("names the field in no block schema of the system prompt", () => {
    expect(JSON.stringify(getBlockSchemaDefinitions())).not.toContain(INFERRED_META)
  })

  it.each(["json-annotations", "json-attributes", "json-callout", "json-chart", "json-regions"])(
    "strips the field from %s at the depth it was added",
    (language) => {
      expect(JSON.stringify(toBlockSchema(configOf(language)))).not.toContain(INFERRED_META)
    }
  )
})
