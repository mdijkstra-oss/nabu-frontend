import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  buildClaimSet,
  collectDocTables,
  deriveTableName,
  isValidIdentifier,
  syncDocTables,
  tableComment,
  toDocTable,
  type ClaimSet,
  type DocTable,
  type TrackedTables,
} from "./doc-tables"
import { formatBlock } from "~/lib/data-blocks/parse"
import { err, ok } from "~/lib/fp/result"
import type { DbColumn, DbError } from "~/lib/db/types"
import type { DbConnection } from "~/lib/db/query"
import type { SyncPlan } from "~/lib/db/sync"
import type { FileStore } from "~/lib/files/store"
import type { TableBlock } from "~/domain/data-blocks/table/schema"

const block = (overrides: Partial<TableBlock> = {}): TableBlock => ({
  id: "table-abc",
  caption: { label: "Monthly expenses" },
  columns: [
    { key: "month", name: "Month", type: "date" },
    { key: "amount", name: "Amount", type: "number" },
    { key: "note", name: "Note", type: "text" },
  ],
  rows: [{ month: "2026-01-05", amount: "42", note: "cleaning" }],
  ...overrides,
})

const notes = block({
  id: "table-xyz",
  caption: { label: "Notes" },
  columns: [{ key: "note", name: "Note", type: "text" }],
  rows: [{ note: "hi" }],
})

const doc = (...blocks: TableBlock[]): string =>
  blocks.map((b) => formatBlock("json-table", JSON.stringify(b))).join("\n\n")

interface Statement {
  verb: "CREATE" | "COMMENT" | "DROP"
  table: string
  comment?: string
}

const CREATE = /^CREATE OR REPLACE TABLE (\S+) \(/
const COMMENT = /^COMMENT ON TABLE (\S+) IS '([\s\S]*)';$/
const DROP = /^DROP TABLE IF EXISTS (\S+);$/

const parseStatement = (sql: string): Statement => {
  const created = CREATE.exec(sql)
  if (created) return { verb: "CREATE", table: created[1] }
  const commented = COMMENT.exec(sql)
  if (commented)
    return { verb: "COMMENT", table: commented[1], comment: commented[2].replace(/''/g, "'") }
  const dropped = DROP.exec(sql)
  if (dropped) return { verb: "DROP", table: dropped[1] }
  throw new Error(`Unrecognised statement: ${sql}`)
}

type Call =
  | { kind: "sql"; sql: string; statement: Statement }
  | { kind: "insert"; table: string; columns: DbColumn[]; rows: Record<string, unknown>[] }

interface Recorder {
  conn: DbConnection
  calls: Call[]
}

const failure: DbError = { type: "query", message: "boom" }

const recordingConnection = (fails: (label: string) => boolean = () => false): Recorder => {
  const calls: Call[] = []
  const conn: DbConnection = {
    runSql: async (sql) => {
      const statement = parseStatement(sql)
      calls.push({ kind: "sql", sql, statement })
      return fails(`${statement.verb} ${statement.table}`) ? err(failure) : ok(undefined)
    },
    insertTable: async (table, columns, rows) => {
      calls.push({ kind: "insert", table, columns, rows })
      return fails(`INSERT ${table}`) ? err(failure) : ok(undefined)
    },
  }
  return { conn, calls }
}

const label = (call: Call): string =>
  call.kind === "insert" ? `INSERT ${call.table}` : `${call.statement.verb} ${call.statement.table}`

const tablesOf = (calls: Call[], verb: Statement["verb"]): string[] =>
  calls.flatMap((call) =>
    call.kind === "sql" && call.statement.verb === verb ? [call.statement.table] : []
  )

const commentsOf = (calls: Call[]): Record<string, string> =>
  Object.fromEntries(
    calls.flatMap((call) =>
      call.kind === "sql" && call.statement.verb === "COMMENT"
        ? [[call.statement.table, call.statement.comment ?? ""]]
        : []
    )
  )

const insertsOf = (calls: Call[]): Record<string, Record<string, unknown>[]> =>
  Object.fromEntries(
    calls.flatMap((call) => (call.kind === "insert" ? [[call.table, call.rows]] : []))
  )

const snapshot = (tracked: TrackedTables): Record<string, string[]> =>
  Object.fromEntries([...tracked].map(([file, names]) => [file, [...names].sort()]))

interface Pass {
  files: FileStore
  batches: SyncPlan[]
  claims?: ClaimSet
  fails?: (label: string) => boolean
}

interface Outcome {
  created: string[]
  dropped: string[]
  comments: Record<string, string>
  inserted: Record<string, Record<string, unknown>[]>
  tracked: Record<string, string[]>
  labels: string[]
}

const mergePlans = (batches: SyncPlan[]): SyncPlan => ({
  deleted: batches.flatMap((b) => b.deleted),
  changed: batches.flatMap((b) => b.changed),
})

const runPass = async (pass: Pass, tracked: TrackedTables): Promise<Outcome> => {
  const { conn, calls } = recordingConnection(pass.fails)
  const claims = pass.claims ?? buildClaimSet(mergePlans(pass.batches), pass.files)

  for (const batch of pass.batches) {
    await syncDocTables(conn, batch, pass.files, claims, tracked)
  }

  return {
    created: tablesOf(calls, "CREATE"),
    dropped: tablesOf(calls, "DROP"),
    comments: commentsOf(calls),
    inserted: insertsOf(calls),
    tracked: snapshot(tracked),
    labels: calls.map(label),
  }
}

const runPasses = async (passes: Pass[]): Promise<Outcome> => {
  const tracked: TrackedTables = new Map()
  let outcome: Outcome | null = null
  for (const pass of passes) outcome = await runPass(pass, tracked)
  if (!outcome) throw new Error("no passes given")
  return outcome
}

const changed = (...files: string[]): SyncPlan => ({ deleted: [], changed: files })
const removed = (...files: string[]): SyncPlan => ({ deleted: files, changed: [] })

describe("deriveTableName", () => {
  const cases = [
    { name: "prefixed short id", id: "table-3k2j9x1a", expected: "table_3k2j9x1a" },
    { name: "every hyphen becomes an underscore", id: "table-a-b", expected: "table_a_b" },
    { name: "an id that already has underscores collides", id: "table-a_b", expected: "table_a_b" },
    { name: "no file part is added", id: "table-abc", expected: "table_abc" },
    { name: "spaces survive so the check can refuse them", id: "table-a b", expected: "table_a b" },
  ]

  it.each(cases)("$name", ({ id, expected }) => {
    expect(deriveTableName(id)).toBe(expected)
  })
})

describe("isValidIdentifier", () => {
  const cases = [
    { name: "derived short id", value: "table_3k2j9x1a", expected: true },
    { name: "single letter", value: "t", expected: true },
    { name: "a space", value: "table_a b", expected: false },
    { name: "an uppercase letter", value: "Table_abc", expected: false },
    { name: "a leading digit", value: "3table", expected: false },
    { name: "a surviving hyphen", value: "table-abc", expected: false },
    { name: "a quote", value: "table_a'b", expected: false },
    { name: "a semicolon", value: "table_a; DROP TABLE files; --", expected: false },
    { name: "empty", value: "", expected: false },
  ]

  it.each(cases)("$name", ({ value, expected }) => {
    expect(isValidIdentifier(value)).toBe(expected)
  })
})

describe("tableComment", () => {
  const cases = [
    {
      name: "clean table is caption and file",
      caption: "Monthly expenses",
      file: "finance/2026.md",
      dirty: 0,
      expected: "Monthly expenses (finance/2026.md)",
    },
    {
      name: "one failing cell reads singular",
      caption: "Monthly expenses",
      file: "finance/2026.md",
      dirty: 1,
      expected: "Monthly expenses (finance/2026.md) — 1 cell fails its column type",
    },
    {
      name: "two failing cells read plural",
      caption: "Monthly expenses",
      file: "finance/2026.md",
      dirty: 2,
      expected: "Monthly expenses (finance/2026.md) — 2 cells fail their column type",
    },
    {
      name: "empty caption yields the file alone",
      caption: "",
      file: "finance/2026.md",
      dirty: 0,
      expected: "finance/2026.md",
    },
    {
      name: "empty caption keeps the dirty count",
      caption: "",
      file: "finance/2026.md",
      dirty: 3,
      expected: "finance/2026.md — 3 cells fail their column type",
    },
    {
      name: "a quote in the caption is left for the SQL layer to escape",
      caption: "It's mine",
      file: "a.md",
      dirty: 0,
      expected: "It's mine (a.md)",
    },
  ]

  it.each(cases)("$name", ({ caption, file, dirty, expected }) => {
    expect(tableComment(caption, file, dirty)).toBe(expected)
  })
})

const projected = (input: TableBlock, file = "a.md"): DocTable => {
  const result = toDocTable(input, file)
  if (!result.ok) throw new Error(`expected a table, got refusal: ${result.error.reason}`)
  return result.value
}

describe("toDocTable", () => {
  it("maps column types to DuckDB types behind a stamped file column", () => {
    expect(projected(block()).schema).toEqual({
      name: "table_abc",
      columns: [
        { name: "file", type: "VARCHAR", nullable: false },
        { name: "month", type: "DATE", nullable: true },
        { name: "amount", type: "DOUBLE", nullable: true },
        { name: "note", type: "VARCHAR", nullable: true },
      ],
    })
  })

  it("stamps the file on every row and carries typed values", () => {
    const table = projected(
      block({
        rows: [
          { month: "2026-01-05", amount: "42", note: "cleaning" },
          { month: "2026-02-05", amount: "17.5", note: "" },
        ],
      })
    )

    expect(table.rows).toEqual([
      { file: "a.md", month: "2026-01-05", amount: 42, note: "cleaning" },
      { file: "a.md", month: "2026-02-05", amount: 17.5, note: null },
    ])
  })

  const cellCases: { name: string; row: Record<string, string>; expected: null }[] = [
    { name: "an unparseable number is null", row: { amount: "about forty" }, expected: null },
    { name: "an unparseable date is null", row: { month: "12/03/2026" }, expected: null },
    { name: "a missing key is null", row: {}, expected: null },
    { name: "an empty string is null", row: { amount: "" }, expected: null },
  ]

  it.each(cellCases)("$name", ({ row, expected }) => {
    const table = projected(block({ rows: [row] }))
    const key = Object.keys(row)[0] ?? "amount"
    expect(table.rows[0][key]).toBe(expected)
  })

  const dirtyCases = [
    {
      name: "one failing cell counts singular in the comment",
      rows: [{ month: "2026-01-05", amount: "about forty", note: "x" }],
      expected: "Monthly expenses (a.md) — 1 cell fails its column type",
    },
    {
      name: "two failing cells count plural in the comment",
      rows: [
        { month: "2026-01-05", amount: "about forty", note: "x" },
        { month: "2026-13-45", amount: "7", note: "y" },
      ],
      expected: "Monthly expenses (a.md) — 2 cells fail their column type",
    },
    {
      name: "empty and missing cells are not failures",
      rows: [{ amount: "", note: "x" }],
      expected: "Monthly expenses (a.md)",
    },
    {
      name: "an empty caption leaves the file alone",
      rows: [],
      expected: "a.md",
      caption: { label: "" },
    },
  ]

  it.each(dirtyCases)("$name", ({ rows, expected, caption }) => {
    expect(projected(block({ rows, ...(caption ? { caption } : {}) })).comment).toBe(expected)
  })

  it("keeps hostile cell values verbatim as data", () => {
    const hostile = "'); DROP TABLE files; --"
    const table = projected(block({ rows: [{ note: hostile, amount: "1", month: "2026-01-05" }] }))

    expect(table.rows[0].note).toBe(hostile)
  })

  const refusalCases = [
    {
      name: "a derived name with a space is refused",
      input: block({ id: "table-a b" }),
      reason: /table name/,
    },
    {
      name: "a derived name starting with a digit is refused",
      input: block({ id: "3abc" }),
      reason: /table name/,
    },
    {
      name: "an uppercase derived name is refused",
      input: block({ id: "Table-abc" }),
      reason: /table name/,
    },
    {
      name: "a column key outside the charset is refused",
      input: block({ columns: [{ key: "Amount", name: "Amount", type: "number" }], rows: [] }),
      reason: /column key/,
    },
    {
      name: "a column key with a quote is refused",
      input: block({ columns: [{ key: "a'b", name: "A", type: "text" }], rows: [] }),
      reason: /column key/,
    },
  ]

  it.each(refusalCases)("$name", ({ input, reason }) => {
    const result = toDocTable(input, "a.md")

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.blockId).toBe(input.id)
    expect(result.error.reason).toMatch(reason)
  })

  it("refuses the block whole rather than dropping the offending column", () => {
    const result = toDocTable(
      block({
        columns: [
          { key: "month", name: "Month", type: "date" },
          { key: "Amount", name: "Amount", type: "number" },
        ],
        rows: [],
      }),
      "a.md"
    )

    expect(result.ok).toBe(false)
  })

  it("declares the columns of a block with no rows", () => {
    const table = projected(block({ rows: [] }))

    expect(table.schema.columns.map((c) => c.name)).toEqual(["file", "month", "amount", "note"])
    expect(table.rows).toEqual([])
  })

  it("gives a block with no columns a file-only table and no rows", () => {
    const table = projected(block({ columns: [], rows: [{}, {}] }))

    expect(table.schema.columns).toEqual([{ name: "file", type: "VARCHAR", nullable: false }])
    expect(table.rows).toEqual([])
  })
})

describe("collectDocTables", () => {
  it("collects every table block in a file", () => {
    const { tables, refused } = collectDocTables(doc(block(), notes), "a.md")

    expect(tables.map((t) => t.name)).toEqual(["table_abc", "table_xyz"])
    expect(refused).toEqual([])
  })

  it("returns nothing for a file with no table blocks", () => {
    expect(collectDocTables("# Notes\n\nprose\n", "a.md")).toEqual({ tables: [], refused: [] })
  })

  it("refuses a block whose derived name is not an identifier and keeps its neighbours", () => {
    const { tables, refused } = collectDocTables(doc(block({ id: "table-a b" }), notes), "a.md")

    expect(tables.map((t) => t.name)).toEqual(["table_xyz"])
    expect(refused.map((r) => r.blockId)).toEqual(["table-a b"])
  })
})

describe("buildClaimSet", () => {
  const abc = doc(block())

  const cases: {
    name: string
    plan: SyncPlan
    files: FileStore
    expected: Record<string, string>
  }[] = [
    {
      name: "claims each derived name for its file",
      plan: changed("a.md"),
      files: { "a.md": doc(block(), notes) },
      expected: { table_abc: "a.md", table_xyz: "a.md" },
    },
    {
      name: "the last synced file wins a duplicate id",
      plan: changed("a.md", "b.md"),
      files: { "a.md": abc, "b.md": abc },
      expected: { table_abc: "b.md" },
    },
    {
      name: "ids colliding after derivation are one claim",
      plan: changed("a.md", "b.md"),
      files: { "a.md": doc(block({ id: "table-a-b" })), "b.md": doc(block({ id: "table-a_b" })) },
      expected: { table_a_b: "b.md" },
    },
    {
      name: "a refused block claims nothing",
      plan: changed("a.md"),
      files: { "a.md": doc(block({ id: "table-a b" })) },
      expected: {},
    },
    {
      name: "deleted files claim nothing",
      plan: removed("a.md"),
      files: { "a.md": abc },
      expected: {},
    },
  ]

  it.each(cases)("$name", ({ plan, files, expected }) => {
    expect(Object.fromEntries(buildClaimSet(plan, files))).toEqual(expected)
  })
})

describe("syncDocTables", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const bothBlocks = doc(block(), notes)
  const onlyAbc = doc(block())

  interface Case {
    name: string
    passes: Pass[]
    expected: {
      created: string[]
      dropped: string[]
      tracked: Record<string, string[]>
      comments?: Record<string, string>
      inserted?: Record<string, Record<string, unknown>[]>
    }
  }

  const cases: Case[] = [
    {
      name: "creates one table per block and tracks them under their file",
      passes: [{ files: { "a.md": bothBlocks }, batches: [changed("a.md")] }],
      expected: {
        created: ["table_abc", "table_xyz"],
        dropped: [],
        tracked: { "a.md": ["table_abc", "table_xyz"] },
        comments: { table_abc: "Monthly expenses (a.md)", table_xyz: "Notes (a.md)" },
      },
    },
    {
      name: "a deleted file drops its tables and the map forgets them",
      passes: [
        { files: { "a.md": bothBlocks }, batches: [changed("a.md")] },
        { files: {}, batches: [removed("a.md")] },
      ],
      expected: { created: [], dropped: ["table_abc", "table_xyz"], tracked: {} },
    },
    {
      name: "a renamed file keeps its table, restamps its rows and drops nothing",
      passes: [
        { files: { "a.md": onlyAbc }, batches: [changed("a.md")] },
        { files: { "b.md": onlyAbc }, batches: [{ deleted: ["a.md"], changed: ["b.md"] }] },
      ],
      expected: {
        created: ["table_abc"],
        dropped: [],
        tracked: { "b.md": ["table_abc"] },
        comments: { table_abc: "Monthly expenses (b.md)" },
        inserted: {
          table_abc: [{ file: "b.md", month: "2026-01-05", amount: 42, note: "cleaning" }],
        },
      },
    },
    {
      name: "a rename whose halves land in different batches still drops nothing",
      passes: [
        { files: { "a.md": onlyAbc }, batches: [changed("a.md")] },
        { files: { "b.md": onlyAbc }, batches: [removed("a.md"), changed("b.md")] },
      ],
      expected: {
        created: ["table_abc"],
        dropped: [],
        tracked: { "b.md": ["table_abc"] },
        comments: { table_abc: "Monthly expenses (b.md)" },
      },
    },
    {
      name: "a block cut into another doc survives when the old file is processed first",
      passes: [
        { files: { "a.md": onlyAbc, "b.md": "# B\n" }, batches: [changed("a.md", "b.md")] },
        { files: { "a.md": "# A\n", "b.md": onlyAbc }, batches: [changed("a.md", "b.md")] },
      ],
      expected: {
        created: ["table_abc"],
        dropped: [],
        tracked: { "b.md": ["table_abc"] },
        comments: { table_abc: "Monthly expenses (b.md)" },
      },
    },
    {
      name: "a block cut into another doc survives when the new file is processed first",
      passes: [
        { files: { "a.md": onlyAbc, "b.md": "# B\n" }, batches: [changed("a.md", "b.md")] },
        { files: { "a.md": "# A\n", "b.md": onlyAbc }, batches: [changed("b.md", "a.md")] },
      ],
      expected: {
        created: ["table_abc"],
        dropped: [],
        tracked: { "b.md": ["table_abc"] },
      },
    },
    {
      name: "a block cut into another doc survives across two batches",
      passes: [
        { files: { "a.md": onlyAbc, "b.md": "# B\n" }, batches: [changed("a.md", "b.md")] },
        {
          files: { "a.md": "# A\n", "b.md": onlyAbc },
          batches: [changed("b.md"), changed("a.md")],
        },
      ],
      expected: {
        created: ["table_abc"],
        dropped: [],
        tracked: { "b.md": ["table_abc"] },
      },
    },
    {
      name: "removing one of two blocks drops only its table",
      passes: [
        { files: { "a.md": bothBlocks }, batches: [changed("a.md")] },
        { files: { "a.md": onlyAbc }, batches: [changed("a.md")] },
      ],
      expected: {
        created: ["table_abc"],
        dropped: ["table_xyz"],
        tracked: { "a.md": ["table_abc"] },
      },
    },
    {
      name: "a column type change rebuilds the table from the block's current declaration",
      passes: [
        {
          files: {
            "a.md": doc(
              block({
                columns: [{ key: "amount", name: "Amount", type: "text" }],
                rows: [{ amount: "42" }],
              })
            ),
          },
          batches: [changed("a.md")],
        },
        {
          files: {
            "a.md": doc(
              block({
                columns: [{ key: "amount", name: "Amount", type: "number" }],
                rows: [{ amount: "42" }],
              })
            ),
          },
          batches: [changed("a.md")],
        },
      ],
      expected: {
        created: ["table_abc"],
        dropped: [],
        tracked: { "a.md": ["table_abc"] },
        inserted: { table_abc: [{ file: "a.md", amount: 42 }] },
      },
    },
    {
      name: "a failed CREATE drops the table it claimed and the next block still syncs",
      passes: [
        {
          files: { "a.md": bothBlocks },
          batches: [changed("a.md")],
          fails: (statement) => statement === "CREATE table_abc",
        },
      ],
      expected: {
        created: ["table_abc", "table_xyz"],
        dropped: ["table_abc"],
        tracked: { "a.md": ["table_xyz"] },
        inserted: { table_xyz: [{ file: "a.md", note: "hi" }] },
      },
    },
    {
      name: "a failed COMMENT drops the table",
      passes: [
        {
          files: { "a.md": bothBlocks },
          batches: [changed("a.md")],
          fails: (statement) => statement === "COMMENT table_abc",
        },
      ],
      expected: {
        created: ["table_abc", "table_xyz"],
        dropped: ["table_abc"],
        tracked: { "a.md": ["table_xyz"] },
      },
    },
    {
      name: "a failed insert drops the table",
      passes: [
        {
          files: { "a.md": bothBlocks },
          batches: [changed("a.md")],
          fails: (statement) => statement === "INSERT table_abc",
        },
      ],
      expected: {
        created: ["table_abc", "table_xyz"],
        dropped: ["table_abc"],
        tracked: { "a.md": ["table_xyz"] },
      },
    },
    {
      name: "a table that failed to build is dropped even though the pass claims its name",
      passes: [
        {
          files: { "a.md": onlyAbc },
          batches: [changed("a.md")],
          claims: new Map([["table_abc", "a.md"]]),
          fails: (statement) => statement === "CREATE table_abc",
        },
      ],
      expected: { created: ["table_abc"], dropped: ["table_abc"], tracked: {} },
    },
    {
      name: "a previously synced table whose block now fails to build is dropped",
      passes: [
        { files: { "a.md": onlyAbc }, batches: [changed("a.md")] },
        {
          files: { "a.md": onlyAbc },
          batches: [changed("a.md")],
          fails: (statement) => statement === "CREATE table_abc",
        },
      ],
      expected: { created: ["table_abc"], dropped: ["table_abc"], tracked: {} },
    },
    {
      name: "a refused block reaches no statement at all and its neighbour still syncs",
      passes: [
        {
          files: { "a.md": doc(block({ id: "table-a b" }), notes) },
          batches: [changed("a.md")],
        },
      ],
      expected: {
        created: ["table_xyz"],
        dropped: [],
        tracked: { "a.md": ["table_xyz"] },
      },
    },
    {
      name: "a block with no rows still gets its table",
      passes: [{ files: { "a.md": doc(block({ rows: [] })) }, batches: [changed("a.md")] }],
      expected: {
        created: ["table_abc"],
        dropped: [],
        tracked: { "a.md": ["table_abc"] },
        inserted: {},
      },
    },
    {
      name: "a block with no columns gets a file-only table and no rows",
      passes: [
        {
          files: { "a.md": doc(block({ columns: [], rows: [{}, {}] })) },
          batches: [changed("a.md")],
        },
      ],
      expected: {
        created: ["table_abc"],
        dropped: [],
        tracked: { "a.md": ["table_abc"] },
        inserted: {},
      },
    },
    {
      name: "an unchanged file in neither half of the batch is left alone",
      passes: [
        { files: { "a.md": onlyAbc }, batches: [changed("a.md")] },
        { files: { "a.md": onlyAbc, "b.md": doc(notes) }, batches: [changed("b.md")] },
      ],
      expected: {
        created: ["table_xyz"],
        dropped: [],
        tracked: { "a.md": ["table_abc"], "b.md": ["table_xyz"] },
      },
    },
    {
      name: "an empty caption comments the file alone",
      passes: [
        {
          files: { "a.md": doc(block({ caption: { label: "" } })) },
          batches: [changed("a.md")],
        },
      ],
      expected: {
        created: ["table_abc"],
        dropped: [],
        tracked: { "a.md": ["table_abc"] },
        comments: { table_abc: "a.md" },
      },
    },
    {
      name: "ATTACK: a duplicate derived name in the same batch only tracks the winner",
      passes: [
        {
          files: {
            "a.md": doc(block({ id: "table-a-b" })),
            "b.md": doc(block({ id: "table-a_b" })),
          },
          batches: [changed("a.md", "b.md")],
        },
      ],
      expected: {
        created: ["table_a_b"],
        dropped: [],
        tracked: { "b.md": ["table_a_b"] },
      },
    },
    {
      name: "ATTACK: the loser's stale tracking entry later drops the winner's live table",
      passes: [
        {
          files: {
            "a.md": doc(block({ id: "table-a-b" })),
            "b.md": doc(block({ id: "table-a_b" })),
          },
          batches: [changed("a.md", "b.md")],
        },
        // b.md is untouched; only a.md changes (loses its own colliding block).
        // The winner's table (owned by b.md) must survive because b.md never changed.
        {
          files: { "a.md": "# no more table\n", "b.md": doc(block({ id: "table-a_b" })) },
          batches: [changed("a.md")],
        },
      ],
      expected: {
        created: [],
        dropped: [],
        tracked: { "b.md": ["table_a_b"] },
      },
    },
    {
      name: "COVERAGE: a previously synced table is dropped once its block's id turns invalid",
      passes: [
        { files: { "a.md": onlyAbc }, batches: [changed("a.md")] },
        {
          files: { "a.md": doc(block({ id: "table-a b" })) },
          batches: [changed("a.md")],
        },
      ],
      expected: { created: [], dropped: ["table_abc"], tracked: {} },
    },
    {
      name: "failing cells ride the comment and insert as null",
      passes: [
        {
          files: {
            "a.md": doc(
              block({
                rows: [
                  { month: "2026-01-05", amount: "about forty", note: "x" },
                  { month: "2026-01-06", amount: "1e309", note: "y" },
                ],
              })
            ),
          },
          batches: [changed("a.md")],
        },
      ],
      expected: {
        created: ["table_abc"],
        dropped: [],
        tracked: { "a.md": ["table_abc"] },
        comments: { table_abc: "Monthly expenses (a.md) — 2 cells fail their column type" },
        inserted: {
          table_abc: [
            { file: "a.md", month: "2026-01-05", amount: null, note: "x" },
            { file: "a.md", month: "2026-01-06", amount: null, note: "y" },
          ],
        },
      },
    },
  ]

  it.each(cases)("$name", async ({ passes, expected }) => {
    const outcome = await runPasses(passes)

    expect(outcome.created).toEqual(expected.created)
    expect(outcome.dropped).toEqual(expected.dropped)
    expect(outcome.tracked).toEqual(expected.tracked)
    if (expected.comments) expect(outcome.comments).toEqual(expected.comments)
    if (expected.inserted) expect(outcome.inserted).toEqual(expected.inserted)
  })

  it("creates, comments and then inserts", async () => {
    const outcome = await runPasses([{ files: { "a.md": onlyAbc }, batches: [changed("a.md")] }])

    expect(outcome.labels).toEqual(["CREATE table_abc", "COMMENT table_abc", "INSERT table_abc"])
  })

  it("logs an error naming the refused block", async () => {
    await runPasses([
      { files: { "a.md": doc(block({ id: "table-a b" })) }, batches: [changed("a.md")] },
    ])

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("table-a b"))
  })

  it("logs an error naming a table that failed to build", async () => {
    await runPasses([
      {
        files: { "a.md": onlyAbc },
        batches: [changed("a.md")],
        fails: (statement) => statement === "CREATE table_abc",
      },
    ])

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("table_abc"),
      expect.anything()
    )
  })

  it("escapes a quoted caption into the comment statement", async () => {
    const { conn, calls } = recordingConnection()
    const files = { "a.md": doc(block({ caption: { label: "It's mine" } })) }

    await syncDocTables(conn, changed("a.md"), files, new Map(), new Map())

    const comment = calls.find((c) => c.kind === "sql" && c.statement.verb === "COMMENT")
    expect(comment?.kind === "sql" && comment.sql).toBe(
      "COMMENT ON TABLE table_abc IS 'It''s mine (a.md)';"
    )
  })

  it("never lets a cell value reach SQL text", async () => {
    const hostile = "'); DROP TABLE files; --"
    const { conn, calls } = recordingConnection()
    const files = {
      "a.md": doc(block({ rows: [{ month: "2026-01-05", amount: "1", note: hostile }] })),
    }

    await syncDocTables(conn, changed("a.md"), files, new Map(), new Map())

    const sql = calls.flatMap((c) => (c.kind === "sql" ? [c.sql] : []))
    expect(sql.some((s) => s.includes("DROP TABLE files"))).toBe(false)
    expect(insertsOf(calls).table_abc[0].note).toBe(hostile)
  })

  it("COVERAGE: a move across two separate passes is a real delete then a real recreate", async () => {
    const tracked: TrackedTables = new Map()

    const pass1 = await runPass({ files: { "a.md": onlyAbc }, batches: [changed("a.md")] }, tracked)
    expect(pass1.created).toEqual(["table_abc"])
    expect(pass1.tracked).toEqual({ "a.md": ["table_abc"] })

    // Separate pass: only a.md changes (loses the block). b.md is untouched by this pass.
    const pass2 = await runPass(
      { files: { "a.md": "# gone\n" }, batches: [changed("a.md")] },
      tracked
    )
    expect(pass2.dropped).toEqual(["table_abc"])
    expect(pass2.tracked).toEqual({})

    // Separate pass again: only b.md changes (gains the block).
    const pass3 = await runPass({ files: { "b.md": onlyAbc }, batches: [changed("b.md")] }, tracked)
    expect(pass3.created).toEqual(["table_abc"])
    expect(pass3.tracked).toEqual({ "b.md": ["table_abc"] })
  })

  it("COVERAGE: a quote in the filename is escaped in the comment statement too", async () => {
    const { conn, calls } = recordingConnection()
    const files = { "it's a file.md": doc(block({ caption: { label: "Clean" } })) }

    await syncDocTables(conn, changed("it's a file.md"), files, new Map(), new Map())

    const comment = calls.find((c) => c.kind === "sql" && c.statement.verb === "COMMENT")
    expect(comment?.kind === "sql" && comment.sql).toBe(
      "COMMENT ON TABLE table_abc IS 'Clean (it''s a file.md)';"
    )
  })

  it("ATTACK: console.error fires exactly once for one refusal in one pass", async () => {
    const errorSpy = vi.mocked(console.error)
    errorSpy.mockClear()

    const tracked: TrackedTables = new Map()
    const plan = changed("a.md")
    const files = { "a.md": doc(block({ id: "table-a b" })) }
    const claims = buildClaimSet(plan, files)
    const { conn } = recordingConnection()

    await syncDocTables(conn, plan, files, claims, tracked)

    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})
