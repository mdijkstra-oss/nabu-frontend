import { describe, it, expect } from "vitest"
import { deriveTypedOps, deriveOpsJsonSchema } from "./derive"
import { getBlockConfig } from "../registry"

type JsonSchema = Record<string, unknown>

const mustGetConfig = (language: string) => {
  const config = getBlockConfig(language)
  if (!config) throw new Error(`no config for ${language}`)
  return config
}

describe("deriveTypedOps", () => {
  interface Case {
    name: string
    language: string
    expectShortName: string
    expectSingleton: boolean
    expectAllowedFiles?: string[]
    expectImmutableFields: string[]
    expectArrayOps: string[]
    expectSetFields: string[]
  }

  const cases: Case[] = [
    {
      name: "json-attributes: singleton, no object arrays, no immutable",
      language: "json-attributes",
      expectShortName: "attributes",
      expectSingleton: true,
      expectImmutableFields: [],
      expectArrayOps: [],
      expectSetFields: ["tags", "date"],
    },
    {
      name: "json-annotations: singleton, annotations array with id",
      language: "json-annotations",
      expectShortName: "annotations",
      expectSingleton: true,
      expectImmutableFields: [],
      expectArrayOps: ["annotations"],
      expectSetFields: [],
    },
    {
      name: "json-callout: non-singleton, id is immutable",
      language: "json-callout",
      expectShortName: "callout",
      expectSingleton: false,
      expectImmutableFields: ["id"],
      expectArrayOps: [],
      expectSetFields: ["type", "title", "content", "color", "collapsed"],
    },
    {
      name: "json-settings: singleton, tags and searches arrays with id, file-locked",
      language: "json-settings",
      expectShortName: "settings",
      expectSingleton: true,
      expectAllowedFiles: ["settings.hidden.md"],
      expectImmutableFields: [],
      expectArrayOps: ["tags", "searches"],
      expectSetFields: ["corpusDescriptions"],
    },
    {
      name: "json-chart: non-singleton, id is immutable, nested objects",
      language: "json-chart",
      expectShortName: "chart",
      expectSingleton: false,
      expectImmutableFields: ["id"],
      expectArrayOps: [],
      expectSetFields: ["caption", "query", "spec"],
    },
  ]

  it.each(cases)(
    "$name",
    ({
      language,
      expectShortName,
      expectSingleton,
      expectAllowedFiles,
      expectImmutableFields,
      expectArrayOps,
      expectSetFields,
    }) => {
      const config = mustGetConfig(language)
      const spec = deriveTypedOps(language, config)

      expect(spec.shortName).toBe(expectShortName)
      expect(spec.singleton).toBe(expectSingleton)
      expect(spec.allowedFiles).toEqual(expectAllowedFiles)
      expect(spec.immutableFields).toEqual(expectImmutableFields)
      expect(spec.arrayOps.map((a) => a.fieldName)).toEqual(expectArrayOps)

      const setProps = (spec.setFieldsSchema as JsonSchema).properties as Record<string, unknown>
      expect(Object.keys(setProps).sort()).toEqual([...expectSetFields].sort())
    }
  )
})

describe("deriveOpsJsonSchema", () => {
  interface Case {
    name: string
    language: string
    expectOpNames: string[]
    expectIsArray: boolean
  }

  const cases: Case[] = [
    {
      name: "attributes: only set op",
      language: "json-attributes",
      expectOpNames: ["set"],
      expectIsArray: true,
    },
    {
      name: "annotations: set + add/remove/set_annotation",
      language: "json-annotations",
      expectOpNames: ["set", "add_annotation", "remove_annotation", "set_annotation"],
      expectIsArray: true,
    },
    {
      name: "settings: set + add/remove/set for tag and search",
      language: "json-settings",
      expectOpNames: [
        "set",
        "add_tag",
        "remove_tag",
        "set_tag",
        "add_search",
        "remove_search",
        "set_search",
      ],
      expectIsArray: true,
    },
    {
      name: "callout: only set op",
      language: "json-callout",
      expectOpNames: ["set"],
      expectIsArray: true,
    },
    {
      name: "chart: only set op",
      language: "json-chart",
      expectOpNames: ["set"],
      expectIsArray: true,
    },
  ]

  const extractOpNames = (schema: unknown): string[] => {
    const s = schema as JsonSchema
    const items = s.items as JsonSchema
    if (items.oneOf) {
      return (items.oneOf as JsonSchema[]).map(
        (variant) => ((variant.properties as Record<string, JsonSchema>).op.enum as string[])[0]
      )
    }
    return [((items.properties as Record<string, JsonSchema>).op.enum as string[])[0]]
  }

  it.each(cases)("$name", ({ language, expectOpNames, expectIsArray }) => {
    const config = mustGetConfig(language)
    const spec = deriveTypedOps(language, config)
    const schema = deriveOpsJsonSchema(spec)
    const s = schema as JsonSchema

    expect(s.type).toBe(expectIsArray ? "array" : undefined)
    expect(extractOpNames(schema)).toEqual(expectOpNames)
  })
})
