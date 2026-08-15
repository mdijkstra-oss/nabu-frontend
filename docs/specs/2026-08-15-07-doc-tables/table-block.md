# Table block

The `json-table` block type: the fenced data block that carries a user-editable table inside a document. This component owns the block's zod schema, its registry entry, its agent-facing constraints, its async validation, and the column-key generation rule that [grid.md](grid.md) and [conversion.md](conversion.md) both call. It owns `app/domain/data-blocks/table/{definition,schema,keys,transforms}.ts`, the `"json-table"` line in `app/lib/data-blocks/registry.ts`, and the `"table"` member added to the renderer union in `app/lib/data-blocks/definition.ts`. `transforms.ts` holds the block edits the grid applies — add and delete column, rename, set type, add and delete row, set cell — each a pure block-in/block-out function, because they are block semantics (a deleted column's key leaving every row, a new column's key coming from the key rule) rather than anything about drawing. It knows nothing about drawing a grid ([grid.md](grid.md)), parsing a cell value ([cell-types.md](cell-types.md)), or creating a DuckDB table ([projection.md](projection.md)).

## Contract

### The shape

A `json-table` block parses against `TableSchema`; the schema is the contract, and `parseTable(content)` — JSON-parse, `safeParse`, typed block or `null`, never throws — is the only reader. Fields, each with its consumer:

- `id` — string, system-generated (`table-` + short id via the existing `fillMissingIds` path, `idPaths: [{ path: "id", prefix: "table" }]`). Immutable, enforced by the existing immutable-field check. [projection.md](projection.md) derives the block's DuckDB table name from it (hyphens become underscores, so `table-3k2j9x1a` owns `table_3k2j9x1a` — the derivation is that file's contract), and the validation loop uses it to match a rewritten block to its original.
- `caption` — `{ label: string }`. `labelKey: "caption.label"` feeds block listings back to the agent; `captionType: "Table"` makes the rendered caption read "Table n: label", numbered by the existing caption machinery.
- `columns` — array of `{ key, name, type }`, possibly empty. A columnless table is representable on purpose: [grid.md](grid.md) lets the user delete the last column and renders a "No columns" placeholder for that state, and [projection.md](projection.md) still creates the table with its `file` column. Rejecting it at the schema would turn a mid-edit grid into a raw code fence, which is the same reject-don't-break failure the cell contract exists to avoid.
  - `key` — the SQL identifier. Schema pattern: lowercase `snake_case`, first character a letter, matching `^[a-z][a-z0-9_]*$`. Two refinements at schema level, because neither needs the corpus or the database and both should fail fast: keys must be unique across `columns`, and a **reserved** key is rejected.

    The charset is necessary and not sufficient — it admits names neither the database nor the language can hand back, and both failures were found only by running the real thing:
    - `file` — sync stamps a `file` column on every projected row (the `fileColumn` convention in `app/lib/db/ddl.ts`), so a user column shadowing it would be silently unreachable.
    - DuckDB's 75 reserved keywords. `when`, `order`, `group`, `end`, `case`, `table`, `check` and `default` are ordinary spreadsheet headers, and each one unquoted is a syntax error rather than a name: `CREATE TABLE t (when DATE)` does not parse, so the whole table goes missing.
    - `constructor` — the one `Object.prototype` name matching the pattern. A row that simply omits that column resolves `row[key]` to a function off the prototype chain, and a non-string then reaches the cell parser, which crashes the agent's validation loop.

    The set lives in `app/lib/db/identifier.ts`, the one authority on whether a string is usable as a bare unquoted identifier, and [projection.md](projection.md) checks against the same module rather than a second copy. [Grid](grid.md) never mints a reserved key because the generation rule below seeds them, so a column named "When" is born `when_2` exactly as "File" is born `file_2`. Consumed by [projection.md](projection.md) as the column name and by every query the agent or a chart writes against the table.

  - `name` — display label, any non-empty string, freely renameable. Consumed only by [grid.md](grid.md) for the column header. Renaming `name` changes nothing downstream — that is the point of splitting it from `key`.
  - `type` — `"text" | "number" | "date"` (`datetime` deferred, per [spec.md](spec.md)). A parsing contract, not a storage format: it selects which parser in [cell-types.md](cell-types.md) judges the cells, and what column type [projection.md](projection.md) declares.

- `rows` — array of objects, `z.record` of string values, possibly empty. One key never survives the parse: `z.record` builds its output by assignment, so a `__proto__` key hits the prototype setter and vanishes rather than becoming the stray-key error below. Rejecting it would cost the model-facing JSON Schema its row shape — the guard has to sit outside the record, and every form of that erases `additionalProperties` from what the agent is shown. It is left as it is, because it loses nothing: the key pattern forbids a leading underscore, so no column can be keyed `__proto__` and no cell can ever have lived under it. Nothing is polluted; the value is always a string, which the setter ignores. Every value is a JSON string regardless of column type — a number cell holds `"42"`, and a non-string value fails the schema rather than being coerced, matching the reject-don't-strip temperament of the chart schema. A key missing from a row is a NULL cell; extra keys are a validation error (below), not a schema error, because `z.record` cannot know the column set. Consumed by [projection.md](projection.md) as the table's rows and by [grid.md](grid.md) as the grid's cells.

Storing everything as strings is deliberate: changing a column's `type` re-parses cells, it never rewrites them, so a type change is always reversible and never lossy.

### Key generation — owned here

`app/domain/data-blocks/table/keys.ts` exports the one function that turns a display `name` into a `key`, called by [conversion.md](conversion.md) when a pipe table's headers become columns and by [grid.md](grid.md) when the user adds a column. The rule, stated once and only here:

1. Split camelCase boundaries (the `toSnakeCase` idea from `app/lib/db/naming.ts`), lowercase everything.
2. Collapse every run of characters outside `[a-z0-9]` into a single underscore; trim leading and trailing underscores.
3. If the result is empty, it becomes `col`; if it starts with a digit, it is prefixed `col_` (so "2024" → `col_2024`).
4. Dedupe against the block's existing keys **with every reserved name seeded into the set** — a second "Amount" becomes `amount_2`, a third `amount_3`, and a column named "File" is born as `file_2` because `file` was never available. "When" and "Order" are born `when_2` and `order_2` for the same reason, which is what keeps the grid from ever minting a key its own schema rejects.

A key is generated once, at column creation, and never regenerated — renames touch `name` only. **Creation is the column's first committed write**: a column exists from the first block write that contains it, and its key derives from whatever `name` that write carries. In-editor drafts before that write ([grid.md](grid.md)'s add-column popover holds a draft name and writes nothing until it commits) are outside this contract — the schema never sees a keyless column because no written block ever contains one. Key immutability is **not machine-enforced**: the immutable-field check covers top-level fields only, and a rename of a key that consistently updates every row is indistinguishable from delete-plus-create, which the dynamic projection handles by rebuilding the table. The cost of such a rename is that existing queries and chart blocks referencing the old column break silently — which is exactly why the constraint below tells the agent never to do it, and why [grid.md](grid.md) offers the user no way to edit a key.

### Registry entry

`jsonTable: BlockTypeConfig<TableBlock>` in `app/domain/data-blocks/table/definition.ts`, registered as `"json-table"` in the `declared` map of `registry.ts` beside the others:

- `renderer: "table"` — a new member of the renderer union in `definition.ts`; the grid component owns everything behind it ([grid.md](grid.md)).
- `singleton: false`, `readonly: []`, `immutable: { id: … }`, `labelKey: "caption.label"`, `captionType: "Table"`, `idPaths: [{ path: "id", prefix: "table" }]`.
- **Not** `projected: true` and no `tableName` — the static projection pipeline builds one shared table per block _type_ from the type's schema, and this block needs one table per block _instance_ shaped by its own `columns`. Instead the config declares `projectedPerBlock: true`, a new boolean on `BlockTypeConfig` mirroring `projected`'s declarative style, with a registry selector `getPerBlockProjectedConfigs()` beside `getProjectedConfigs()`. [projection.md](projection.md) is the only consumer and owns everything downstream of the flag.

Because the schema is static — generic `columns` and `rows`, nothing document-dependent — the block joins `getBlockSchemaDefinitions()` like every other type and flows into the system prompt without breaking prompt caching. What stays out of the prompt is the _instances_: no per-document table names or column lists ever enter the static schema listing; the agent discovers live tables at runtime through its query tool, per [spec.md](spec.md).

### Constraints — the prose the schema cannot say

The config's `constraints: string[]` (the field `definition.ts` describes as "rules the schema cannot express, handed to the model as prose") carries, verbatim in intent:

- To rename a column, change its `name` only — never its `key`. The key is the column's SQL name; the projected table and every existing query and chart depend on it.
- To delete a column, remove its entry from `columns` and remove its key from every row.
- A new column gets a snake_case `key` generated from its `name` (lowercase, underscores, deduped with numeric suffixes like `amount_2`); the key never changes afterwards. `file` is reserved.
- Every cell value is a JSON string, whatever the column's type (`"42"`, not `42`); a key missing from a row is a NULL cell.
- Each table is queryable as its own SQL table named `table_<id>`; query it to see current columns and data rather than assuming.

These sentences are static text, cache-safe, and are the agent's entire manual for key-vs-name semantics.

### Async validation

`asyncValidate` on the config, mirroring the chart block's `validateChartQuery` slot, returning `ValidationError[]` (the shape in `app/lib/data-blocks/validate.ts`):

- **Row/column agreement**: every key in every row must match some column's `key`. A stray key errors as `{ block: "json-table", field: "rows.<index>.<key>", message }` naming the unknown key and listing the known ones.
- **Cell parses**: every present cell value must parse against its column's declared `type`. Parsing is owned by [cell-types.md](cell-types.md) — this validator consumes its `tableFailures(columns, rows)` list and maps each `{row, column}` entry to a `ValidationError` with `field: "rows.<index>.<key>"` and the column's type in the message, restating nothing about what "parses as a date" means. The agent sees exactly which cells to fix.

These checks need neither corpus nor database, but they live in `asyncValidate` rather than schema refinements **on purpose**: the async pass runs only on the agent-write path (`validateBlocksAsync`), so failures bounce to the agent through the existing validation loop, while a user typing "soon" into a date cell in the grid is never blocked — the document stays schema-valid, the cell renders red per [grid.md](grid.md), and it syncs as NULL per [projection.md](projection.md). One rule, two audiences, enforced only against the one that can read an error message.

Side effects at this boundary: none. The block type is pure data — parsing and validation touch nothing; every effect (DDL, sync, rendering) belongs to a neighbor.

## Prior art

**The chart block is the template.** `app/domain/data-blocks/chart/definition.ts` is mirrored field-for-field where the semantics match: non-singleton, immutable `id` with the same message shape, `caption.label` as `labelKey`, a caption type, one root `idPaths` entry, `asyncValidate` in the config. `schema.ts`'s `parseChart` temperament (safeParse, `null`, never throw) and its `.describe()`-as-LLM-manual habit carry over to `TableSchema`. One deliberate deviation: chart lazy-imports its validator to break an import cycle through the database and file store; the table validator reaches only `cell-types`, no cycle exists, and the import is direct — copying the indirection would be cargo cult.

**`toSnakeCase` (`app/lib/db/naming.ts`) — extended, not reused.** It converts camelCase JSON keys and nothing else; display names are free text ("Amount ($)", "2024"), so `keys.ts` wraps its boundary-splitting idea in the fuller rule above rather than calling it and hoping.

**Rejected: `projected: true` with a `tableName`.** The static pipeline shapes one table per type from the type's zod schema; a per-instance table shaped by runtime `columns` is a different lifecycle, owned by [projection.md](projection.md).

**Rejected: typed JSON cell values** (numbers as numbers, dates as strings). A column type change would then rewrite every cell, and a failed parse would have nowhere to keep the user's original text. Strings-with-a-parsing-contract keeps every keystroke.

**Rejected: schema-level cell-parse refinements.** They would make a user's half-typed document invalid to the whole block pipeline, breaking the render path; the agent-only async pass gives the same enforcement to the only writer that must be gated.

## Tests

Unit tests are vitest, colocated (`schema.test.ts`, `keys.test.ts` beside their sources), table-driven `it.each` in the style of `app/domain/data-blocks/chart/schema.test.ts`.

### Skeleton

This component's slice of the walking skeleton in [spec.md](spec.md) — paste a small pipe table into a doc → it converts to a `json-table` block → renders as a grid → after sync `SELECT * FROM table_<id>` returns the rows — is the middle joint: the block [conversion.md](conversion.md) emits parses non-null through the real registry (`getBlockConfig("json-table")` → `TableSchema`), `fillMissingIds` stamps it a `table-` id, `resolveBlockLabel` and the caption machinery read it, and `getPerBlockProjectedConfigs()` surfaces it to the projection path. If this joint holds, the skeleton's ends can meet.

### Contract

Riskiest first — the agent-written garbage that must die at the gate, then the shapes that must live.

> **Given** hostile content — not JSON, a JSON string, an array, an object missing `columns` or `rows` — **when** parsed, **then** `parseTable` returns `null` and does not throw.

> **Given** duplicate column keys (`amount` twice), **when** parsed, **then** rejected at the schema — two columns cannot share one SQL name.

> **Given** a column keyed `file`, **when** parsed, **then** rejected at the schema with a message naming the reservation.

> **Given** malformed keys — `unitPrice`, `2col`, `has-hyphen`, `has space`, empty string — **when** parsed, **then** each rejected by the key pattern; `unit_price`, `col_2024`, `a` accepted.

> **Given** a row value that is not a string (`42`, `true`, `null`, an object), **when** parsed, **then** rejected — values are JSON strings, never coerced.

> **Given** `columns: []` or `rows: []`, **when** parsed, **then** accepted — an empty table is a table, and so is a columnless one being edited down to nothing.

> **Given** a block and one structural edit — add column at an index, delete a column, rename, set type, add row, delete row, set cell — **when** the transform runs, **then** the next block carries exactly that change: a deleted column's key is gone from every row, a rename leaves `key` and every row untouched, a type change leaves every cell string byte-identical, and an added column's key comes from the key rule against the block's existing keys.

> **Given** a row carrying a key no column declares, **when** `asyncValidate` runs, **then** one `ValidationError` per stray key with `field` `rows.<index>.<key>`, and the error reaches the agent through the existing validation loop.

> **Given** a cell that fails its column's type (with [cell-types.md](cell-types.md)'s `tableFailures` faked to return that one `{row, column}` entry), **when** `asyncValidate` runs, **then** an error naming that exact cell in `field`; an empty failure list produces no error.

> **Given** an edit that changes a block's `id`, **when** validated against the original, **then** the existing immutable-field check rejects it.

> **Given** display names through key generation — "Amount" → `amount`, "Amount ($)" → `amount`, second "Amount" → `amount_2`, "unitPrice" → `unit_price`, "2024" → `col_2024`, "File" → `file_2`, "$$$" → `col` — **when** generated, **then** each key comes out as listed, and generating against the same existing-key set is deterministic.

> **Given** a minimal valid block — one text column, one row, one missing-key NULL cell — **when** parsed and async-validated, **then** clean; and its `constraints` sentences appear in `getBlockSchemaDefinitions()` output for `json-table`.

### Isolation

This component runs alone with every neighbor faked at its contract line: [cell-types.md](cell-types.md)'s `tableFailures` is stubbed to return chosen failure entries by fiat — this suite tests that entries become correctly-addressed errors, never what parses; no database, file store, or editor is touched, because nothing here has a side effect. The registry entry is exercised real — it is this component's own surface. Grid, conversion, and projection consume `TableSchema`, `keys.ts`, and `projectedPerBlock` respectively and appear here only as the named consumers that justify each field.
