import { describe, it, expect } from "vitest"
import { validateSql } from "~/lib/search/semantic"
import { buildRegionSearch } from "./queries"

describe("buildRegionSearch", () => {
  const search = buildRegionSearch({ kind: "speaker", value: "rutte", label: "rutte" })

  it("filters the regions table on kind and value", () => {
    expect(search.sql).toBe(
      "SELECT file, quote AS text, startSentence, endSentence FROM regions WHERE kind = 'speaker' AND parsed_value = 'rutte' ORDER BY file, startSentence"
    )
  })

  it("titles the search with the kind tag and display label", () => {
    const dated = buildRegionSearch({
      kind: "date",
      value: "2026-08-02T00:00:00Z",
      label: "2 Aug 2026",
    })
    expect(dated.title).toBe(":date: 2 Aug 2026")
    expect(dated.description).toBe("Passages where date is 2 Aug 2026")
  })

  it("escapes quotes in the value", () => {
    const quoted = buildRegionSearch({ kind: "speaker", value: "o'brien", label: "o'brien" })
    expect(quoted.sql).toContain("parsed_value = 'o''brien'")
  })

  it("produces SQL the validator accepts", () => {
    expect(validateSql(search.sql).ok).toBe(true)
  })
})
