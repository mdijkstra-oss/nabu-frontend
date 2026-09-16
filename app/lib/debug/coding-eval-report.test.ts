import { describe, expect, it } from "vitest"
import type { Annotation } from "~/domain/data-blocks/attributes/schema"
import { compareCodingDocuments } from "./coding-eval-comparison"
import { aggregateCodingResults, type CodingDocumentOutcome } from "./coding-eval-report"

const finding = (text: string, code = "code-a"): Annotation => ({
  text,
  reason: "test",
  color: undefined,
  code,
})

const markdown = (prose: string, annotations: Annotation[]): string =>
  `${prose}\n\n\`\`\`json-annotations\n${JSON.stringify({ annotations })}\n\`\`\``

const outcome = (
  name: string,
  status: CodingDocumentOutcome["status"],
  comparison?: CodingDocumentOutcome["comparison"]
): CodingDocumentOutcome => ({
  name,
  status,
  annotationCount: status === "empty" ? 0 : status === "success" ? 1 : null,
  goldAnnotationCount: comparison
    ? comparison.matches.length + comparison.falseNegatives.length
    : 1,
  warnings: [],
  failures: [],
  ...(comparison ? { comparison } : {}),
})

describe("coding evaluation aggregates", () => {
  it("reports every aggregate from document-level results", () => {
    const exact = compareCodingDocuments(
      markdown("One.", [finding("One.")]),
      markdown("One.", [finding("One."), finding("One.")])
    )
    const ambiguous = compareCodingDocuments(
      markdown("Echo. Other. Echo.", [finding("Echo.")]),
      markdown("Echo. Other. Echo.", [finding("Echo.")])
    )
    const unresolved = compareCodingDocuments(
      markdown("One.", [finding("Missing.")]),
      markdown("One.", [finding("Missing.")])
    )
    const emptySpurious = compareCodingDocuments(
      markdown("One.", [finding("One.")]),
      markdown("One.", [])
    )
    const empty = compareCodingDocuments(markdown("Quiet.", []), markdown("Quiet.", []))
    const report = aggregateCodingResults(
      [
        outcome("exact", "success", exact),
        outcome("ambiguous", "success", ambiguous),
        outcome("unresolved", "success", unresolved),
        outcome("spurious", "success", emptySpurious),
        outcome("empty", "empty", empty),
        outcome("partial", "partial"),
        outcome("failed", "failed"),
        outcome("malformed", "malformed"),
      ],
      ["code-a"],
      {
        latencyMs: 80,
        requests: [
          {
            endpoint: "/deep-analysis-filter.voter-one",
            durationMs: 5,
            attempts: 1,
            retryReasons: [],
            providerMetadata: {},
          },
        ],
        retries: 1,
        diagnostics: ["worker note"],
      }
    )

    expect(report.outcomes).toEqual({
      success: 4,
      empty: 1,
      partial: 1,
      failed: 1,
      malformed: 1,
    })
    expect(report.complete).toBe(false)
    expect(report.soft.f1).toBe(0)
    expect(report.relaxed.f1).toBe(0)
    expect(report.exact.f1).toBe(0)
    expect(report.meanIoU).toBe(1)
    expect(report.perCode).toHaveLength(1)
    expect(report.perCode[0]).toMatchObject({ code: "code-a", tp: 2, fp: 2, fn: 2 })
    expect(report.falsePositivesOnEmptyGold).toBe(1)
    expect(report.duplicates).toEqual({ documents: 1, findings: 1 })
    expect(report.ambiguous).toEqual({ documents: 0, findings: 0 })
    expect(report.unresolved).toEqual({ documents: 1, findings: 2 })
    expect(report.latencyMs).toEqual({ run: 80, requestMean: 5, requestMin: 5, requestMax: 5 })
    expect(report.requests).toHaveLength(1)
    expect(report.retries).toBe(1)
    expect(report.diagnostics).toEqual(["worker note"])
    expect(report.endpoints).toEqual(["/deep-analysis-filter.voter-one"])
  })

  it("keeps codes the model invented outside the codebook in the per-code table", () => {
    const comparison = compareCodingDocuments(
      markdown("One.", [finding("One.", "invented")]),
      markdown("One.", [finding("One.")])
    )
    const report = aggregateCodingResults([outcome("invented", "success", comparison)], ["code-a"])
    expect(report.perCode.map((score) => score.code)).toEqual(["code-a", "invented"])
    expect(report.perCode.reduce((sum, score) => sum + score.fp, 0)).toBe(report.relaxed.fp)
  })
})
