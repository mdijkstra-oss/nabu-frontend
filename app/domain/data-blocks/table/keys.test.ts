import { describe, it, expect } from "vitest"
import { generateColumnKey, generateColumnKeys } from "./keys"

describe("generateColumnKey — the rule", () => {
  const cases: { name: string; existing: string[]; key: string }[] = [
    { name: "Amount", existing: [], key: "amount" },
    { name: "Amount ($)", existing: [], key: "amount" },
    { name: "Amount", existing: ["amount"], key: "amount_2" },
    { name: "Amount", existing: ["amount", "amount_2"], key: "amount_3" },
    { name: "unitPrice", existing: [], key: "unit_price" },
    { name: "2024", existing: [], key: "col_2024" },
    { name: "File", existing: [], key: "file_2" },
    { name: "$$$", existing: [], key: "col" },
    { name: "$$$", existing: ["col"], key: "col_2" },
    { name: "  Total Spend  ", existing: [], key: "total_spend" },
    { name: "has-hyphen", existing: [], key: "has_hyphen" },
    { name: "%", existing: [], key: "col" },
    { name: "Q1 2024", existing: [], key: "q1_2024" },
    { name: "unitPriceUSD", existing: [], key: "unit_price_usd" },
    { name: "q1Total", existing: [], key: "q1_total" },
    { name: "___", existing: [], key: "col" },
    { name: "file", existing: [], key: "file_2" },
    { name: "File", existing: ["file_2"], key: "file_3" },
  ]

  it.each(cases)('"$name" against $existing → $key', ({ name, existing, key }) => {
    expect(generateColumnKey(name, existing)).toBe(key)
  })

  it("is deterministic against the same existing-key set", () => {
    const existing = ["amount", "amount_2", "month"]
    const runs = Array.from({ length: 5 }, () => generateColumnKey("Amount ($)", existing))

    expect(new Set(runs).size).toBe(1)
    expect(runs[0]).toBe("amount_3")
  })

  it("leaves the existing-key list untouched", () => {
    const existing = ["amount"]
    generateColumnKey("Amount", existing)

    expect(existing).toEqual(["amount"])
  })
})

describe("generateColumnKeys — a whole header row", () => {
  const cases: { name: string; names: string[]; keys: string[] }[] = [
    {
      name: "duplicate headers get numeric suffixes",
      names: ["Amount", "Amount", "Amount"],
      keys: ["amount", "amount_2", "amount_3"],
    },
    {
      name: "headers colliding after normalization still separate",
      names: ["Amount ($)", "amount", "AMOUNT"],
      keys: ["amount", "amount_2", "amount_3"],
    },
    {
      name: "the reserved name is never handed out",
      names: ["File", "file"],
      keys: ["file_2", "file_3"],
    },
    {
      name: "unnameable headers fall back to col",
      names: ["$$$", "???"],
      keys: ["col", "col_2"],
    },
    {
      name: "a mixed header row",
      names: ["Month", "unitPrice", "2024", "Note"],
      keys: ["month", "unit_price", "col_2024", "note"],
    },
    { name: "an empty header row", names: [], keys: [] },
  ]

  it.each(cases)("$name", ({ names, keys }) => {
    expect(generateColumnKeys(names)).toEqual(keys)
  })

  it("produces keys that all pass the schema pattern", () => {
    const keys = generateColumnKeys(["Amount ($)", "2024", "$$$", "File", "unitPrice"])

    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]*$/)
  })
})
