import { describe, it, expect } from "vitest"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import { extendRangeForAnnotations } from "./extend-annotations"

const ann = (text: string, id = "a"): Annotation => ({ id, text, code: "x" }) as Annotation

describe("extendRangeForAnnotations", () => {
  const source = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi"
  const offsetOf = (sub: string) => ({
    start: source.indexOf(sub),
    end: source.indexOf(sub) + sub.length,
  })

  it("no annotations → range unchanged", () => {
    const range = { start: 5, end: 15 }
    expect(extendRangeForAnnotations(range, [], source)).toEqual(range)
  })

  it("annotation entirely inside → range unchanged", () => {
    const range = offsetOf("alpha beta gamma delta")
    const result = extendRangeForAnnotations(range, [ann("beta gamma")], source)
    expect(result).toEqual(range)
  })

  it("annotation entirely outside → range unchanged", () => {
    const range = offsetOf("alpha beta")
    const result = extendRangeForAnnotations(range, [ann("theta iota")], source)
    expect(result).toEqual(range)
  })

  it("annotation overlapping start → range extended left", () => {
    const range = offsetOf("gamma delta")
    const annText = "beta gamma"
    const result = extendRangeForAnnotations(range, [ann(annText)], source)
    expect(result.start).toBe(source.indexOf(annText))
    expect(result.end).toBe(range.end)
  })

  it("annotation overlapping end → range extended right", () => {
    const range = offsetOf("gamma delta")
    const annText = "delta epsilon"
    const result = extendRangeForAnnotations(range, [ann(annText)], source)
    expect(result.start).toBe(range.start)
    expect(result.end).toBe(source.indexOf(annText) + annText.length)
  })

  it("annotation spanning both ends → range extended both ways", () => {
    const range = offsetOf("gamma delta")
    const annText = "beta gamma delta epsilon"
    const result = extendRangeForAnnotations(range, [ann(annText)], source)
    expect(result.start).toBe(source.indexOf(annText))
    expect(result.end).toBe(source.indexOf(annText) + annText.length)
  })

  it("unfindable annotation text → skipped", () => {
    const range = { start: 5, end: 15 }
    const result = extendRangeForAnnotations(range, [ann("nonexistent foo bar")], source)
    expect(result).toEqual(range)
  })

  it("multiple overlapping annotations compound extension", () => {
    const range = offsetOf("gamma delta")
    const a1 = "beta gamma"
    const a2 = "delta epsilon"
    const result = extendRangeForAnnotations(range, [ann(a1), ann(a2)], source)
    expect(result.start).toBe(source.indexOf(a1))
    expect(result.end).toBe(source.indexOf(a2) + a2.length)
  })
})
