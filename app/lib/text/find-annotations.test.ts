import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"
import { findMatchOffset } from "./find"
import { findSingletonBlock, parseBlockJson, stripBlocksByLanguage } from "~/lib/data-blocks/parse"

interface AnnotationData {
  annotations: { text: string; id: string }[]
}

const fixture = readFileSync(join(__dirname, "fixtures/ministerraad.md"), "utf-8")

const annotationsBlock = findSingletonBlock(fixture, "json-annotations")
if (!annotationsBlock) throw new Error("fixture missing json-annotations block")
const parsed = parseBlockJson<AnnotationData>(annotationsBlock)
if (!parsed.ok) throw new Error("failed to parse annotations block")
const { data } = parsed

const docContent = stripBlocksByLanguage(
  stripBlocksByLanguage(fixture, "json-annotations"),
  "json-attributes"
)

const cases = data.annotations.map((a) => ({
  id: a.id,
  text: a.text,
}))

describe("findMatchOffset — annotation texts in ministerraad fixture", () => {
  it.each(cases)("$id finds exactly one match", ({ text }) => {
    const match = findMatchOffset(docContent, text)
    expect(match).not.toBeNull()

    const firstIdx = docContent.indexOf(text)
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    const secondIdx = docContent.indexOf(text, firstIdx + text.length)
    expect(secondIdx).toBe(-1)
  })
})
