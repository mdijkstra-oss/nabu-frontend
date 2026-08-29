import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { stripBlocksByLanguage } from "~/lib/data-blocks/parse"
import { classifyCodingOutput } from "./coding-eval"
import { parseCodingBatchArgs, preflightCodingGateway } from "./coding-eval-batch"
import { compareCodingDocuments } from "./coding-eval-comparison"
import { loadCodingEvalDataset } from "./coding-eval-dataset"
import { aggregateCodingResults } from "./coding-eval-report"

const okResult = { status: "ok" as const, output: "ok", mutations: [] }
const annotationBlock = (annotations: unknown[]): string =>
  `Text.\n\n\`\`\`json-annotations\n${JSON.stringify({ annotations })}\n\`\`\``

describe("coding batch contracts", () => {
  it("defaults to the isolated voter-one configuration inputs", () => {
    vi.stubEnv("VITE_LLM_HOST", "")
    expect(parseCodingBatchArgs(["--output", "run"])).toMatchObject({
      goldDir: resolve(homedir(), "Desktop/ptc-gold-small"),
      output: "run",
      documentsInFlight: 1,
      gateway: "http://localhost:8081",
    })
    vi.stubEnv("VITE_LLM_HOST", "https://gateway.example.com")
    expect(parseCodingBatchArgs(["--output", "run"])).toMatchObject({
      gateway: "https://gateway.example.com",
    })
    vi.unstubAllEnvs()
  })

  it("preflights gateway health and explains stack recovery", async () => {
    await expect(
      preflightCodingGateway(
        "http://gateway",
        vi.fn(async () => new Response("ok"))
      )
    ).resolves.toBeUndefined()
    await expect(
      preflightCodingGateway(
        "http://gateway",
        vi.fn(async () => new Response("no", { status: 503 }))
      )
    ).rejects.toThrow("docker compose up -d chancery")
  })

  it("classifies annotations, empty output, malformed output, and partial failure", () => {
    const annotation = { text: "Text.", reason: "why", code: "code-a" }
    expect(classifyCodingOutput(okResult, annotationBlock([annotation]))).toMatchObject({
      status: "success",
      annotationCount: 1,
    })
    expect(classifyCodingOutput(okResult, annotationBlock([]))).toMatchObject({
      status: "empty",
      annotationCount: 0,
    })
    expect(classifyCodingOutput(okResult, "Text.")).toMatchObject({ status: "malformed" })
    expect(
      classifyCodingOutput(
        okResult,
        annotationBlock([
          { text: "Text.", reason: "valid", code: "code-a" },
          { text: 42, reason: "invalid", code: "code-a" },
        ])
      )
    ).toMatchObject({ status: "malformed" })
    expect(
      classifyCodingOutput(
        { status: "partial", output: "some", message: "one request failed", mutations: [] },
        annotationBlock([])
      )
    ).toMatchObject({ status: "partial", warnings: ["one request failed"] })
    expect(
      classifyCodingOutput(
        { status: "error", output: "requests exhausted", mutations: [] },
        annotationBlock([])
      )
    ).toMatchObject({ status: "failed", failures: ["requests exhausted"] })
  })
})

describe("coding dataset and file-level report fixture", () => {
  const fixture = resolve("app/lib/debug/fixtures/coding-eval")

  it("loads files, compares predictions, and aggregates known results", () => {
    const dataset = loadCodingEvalDataset(resolve(fixture, "gold"))
    const outcomes = dataset.documents.map((document) => {
      const prediction = readFileSync(resolve(fixture, "predictions", document.name), "utf8")
      return {
        name: document.name,
        status: "success" as const,
        annotationCount: 1,
        latencyMs: 10,
        requests: [],
        retries: 0,
        warnings: [],
        failures: [],
        comparison: compareCodingDocuments(prediction, document.markdown),
      }
    })
    const report = aggregateCodingResults(
      outcomes,
      dataset.dimensions.map((dimension) => dimension.id)
    )
    expect(dataset.documents.map((document) => document.name)).toEqual(["a.md", "b.md"])
    expect(report.relaxed).toMatchObject({ tp: 1, fp: 1, fn: 0 })
    expect(report.falsePositivesOnEmptyGold).toBe(1)
  })

  it.runIf(existsSync(resolve(homedir(), "Desktop/ptc-gold-small")))(
    "validates the external small gold corpus",
    () => {
      const dataset = loadCodingEvalDataset(resolve(homedir(), "Desktop/ptc-gold-small"))
      const ids = new Set(dataset.dimensions.map((dimension) => dimension.id))
      expect(ids.size).toBeGreaterThan(0)
      for (const document of dataset.documents)
        for (const annotation of document.annotations)
          expect(ids.has(annotation.code ?? "")).toBe(true)
      for (const id of ids) {
        const documentCount = dataset.documents.filter((document) =>
          document.annotations.some((annotation) => annotation.code === id)
        ).length
        expect(documentCount, id).toBeGreaterThanOrEqual(3)
      }
      expect(dataset.documents.filter((document) => document.annotations.length === 0).length).toBe(
        2
      )
      for (const document of dataset.documents)
        expect(stripBlocksByLanguage(document.markdown, "json-annotations").length).toBeGreaterThan(
          0
        )
    }
  )
})
