import type { TableBlock } from "./schema"

// One canonical block, shared by the domain contract tests and the grid's
// stories, so a change to the shape shows up in both at once.
export const tableFixture = (): TableBlock => ({
  id: "table-fixture1",
  caption: { label: "Monthly expenses" },
  columns: [
    { key: "month", name: "Month", type: "date" },
    { key: "amount", name: "Amount", type: "number" },
    { key: "note", name: "Note", type: "text" },
  ],
  rows: [
    { month: "2026-01-05", amount: "42", note: "cleaning" },
    { month: "2026-02-05", amount: "17.5", note: "" },
  ],
})

// The same block with one cell that cannot parse under its column's type.
export const dirtyTableFixture = (): TableBlock => {
  const block = tableFixture()
  return {
    ...block,
    rows: [{ ...block.rows[0], amount: "about forty" }, block.rows[1]],
  }
}
