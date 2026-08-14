# Cell types

The parsing and type-inference contract for `json-table` cells. Every cell in a [table block](table-block.md) is stored as a JSON string; a column's declared type — `text` | `number` | `date` (datetime deferred) — is a parsing contract, not a storage format. This module is the shared library that says, for one raw string and one declared type, whether the cell is empty, valid, or invalid — and for a whole column of raw strings, which type it should be declared as. It is pure: string in, result out; no I/O, no DOM, no database. It lives in `app/lib/cells/` — a generic building block per the repo's lib/domain split, with nothing table-block-specific in it.

Consumers: the [grid](grid.md) marks invalid cells red; the [projection](projection.md) inserts invalid cells as NULL and writes the table's dirty-cell count into its SQL COMMENT; the block's asyncValidate ([table-block.md](table-block.md)) rejects agent writes that introduce invalid cells, naming them; [conversion](conversion.md) infers column types from a pasted pipe table. All four call this module and nothing else for cell semantics — no consumer re-derives its own notion of "is this a number".

## Contract

### Cell verdicts

`parseCell(raw, type)` takes one raw string and one declared type and returns exactly one of three verdicts:

- **empty** — the cell means "no value". A cell is empty when the key is missing from the row, or when the string's trim is `""`. Emptiness is type-independent. Empty is not a failure: it projects as NULL, is never marked red, and counts as neither a parse nor a fail during inference.
- **valid** — the string parses under the declared type, carrying the typed value:
  - `text` → the raw string, byte-for-byte — no trimming, text never transforms.
  - `number` → a finite JS number.
  - `date` → the canonical `YYYY-MM-DD` string (validated, not converted — no `Date` object, so no timezone drift between grid, projection, and validation).
- **invalid** — the string does not parse under the declared type. No reason field: the consumer already holds the raw string and the declared type, which is everything any message needs (subtractive test — no consumer asked for more).

Non-string cell values never reach this module; the block schema in [table-block.md](table-block.md) guards that boundary. `text` cells are never invalid — any non-empty string is a valid text value.

### Number format

After trimming ASCII whitespace from both ends, the string must match **exactly the JSON number grammar**: optional leading `-`, an integer part with no leading zeros (`0` itself is fine), optional `.` followed by digits, optional exponent (`e`/`E`, optional sign, digits). The result must be finite. Everything else is invalid. Recorded consequences:

- Surrounding whitespace is trimmed before parsing — pipe-table cells arrive padded (`| 42 |`), so conversion depends on this. Interior whitespace is invalid.
- No thousands separators — `1,000` and `1.000.000` are locale-ambiguous; `1.000` parses as the number one.
- No leading `+`, no hex (`0x10`), no `Infinity`/`NaN` words, no underscores, no non-ASCII digits.
- No leading zeros: `007` is invalid. Deliberate — ID, zip, and phone columns keep their zeros and stay text under inference instead of being swallowed as numbers.
- Exponents are accepted, but a non-finite result fails: `1e309` overflows a double and is invalid.
- Values round to the nearest IEEE double; the raw string in the block remains the source of truth.

### Date format

After trimming, exactly one accepted form: **`YYYY-MM-DD`** — four-digit year, zero-padded two-digit month and day, and a real calendar date (month 01–12, day valid for that month, Gregorian leap rule). Recorded consequences:

- `2026-13-45`, `2026-02-30`, and `2026-02-29` (not a leap year) are invalid; `2024-02-29` is valid.
- Non-padded forms (`2026-1-5`), slash forms (`2026/01/05`), and any day/month-ambiguous ordering (`12/03/2026`) are invalid. ISO is the anchor; ambiguity is rejected, not guessed.
- Any time suffix (`2026-01-01T10:00`) is invalid — when datetime arrives as its own type, `date` keeps its meaning unchanged.

The number and date grammars are disjoint (dates require hyphens, numbers forbid them): no string is valid under both.

### Table summary

`tableFailures(columns, rows)` folds one table — columns as `{key, type}` pairs, rows as records of raw strings — into the ordered list of invalid cells, each identified by:

- `row` — index into the rows array; asyncValidate and any message render it as they choose.
- `column` — the column key; joins back to the column's display name in the block if a consumer wants it (name is omitted here — subtractive test, no consumer needs it inside this module).

That list serves both non-grid consumers: the projection's dirty-cell count is its length; asyncValidate names each entry. Empty cells never appear in it. The grid does not use it — per-cell validity is `parseCell` called per cell, which the grid does anyway while rendering; a second per-cell API would duplicate the first.

### Inference

`inferColumnType(values)` takes one column of raw strings and returns the type the column should be declared as, used by [conversion](conversion.md):

- Empty cells (trim `""`) are excluded from the denominator. An all-empty column is `text`.
- The column becomes `number` or `date` when **more than half** of its non-empty cells parse as that type. Exactly 50% is not more than half — the column stays `text`. The >50% threshold is a recorded default.
- When both number and date clear the bar, the higher parse rate wins; a tie goes to `number`. (With disjoint grammars the rates sum to at most 100%, so this branch is unreachable today — the rule is recorded so the behavior is pinned if the grammars ever overlap.)
- Otherwise `text`. `text` is the floor, never a failure.

Inference reuses `parseCell` verdicts — the same grammar decides both, so a freshly converted column can only be red where inference already counted a fail.

## Prior art

Searched `app/lib` for existing coercion and parsing:

- `app/lib/chart/format.ts` — `toNumber` and `toDate` exist but are **rejected** as the validity contract: they are display coercions built on `Number()` and `new Date()`. `Number("")` is `0`, `Number("0x10")` is `16`, `Number("1e309")` is `Infinity` (not NaN, so it passes), and `new Date(string)` is engine-dependent, accepts US-ordered slash dates, and shifts by timezone. Every one of those is a wrong answer under this contract. They stay untouched for chart display.
- `app/lib/chart/format.test.ts` — the table-driven vitest convention this module's tests mirror; reused as a pattern, not as code.
- `d3-time-format` (already a dependency) — `timeParse("%Y-%m-%d")` was the closest candidate for date validation; **rejected** because it returns a timezone-local `Date` object and does not reliably reject rolled-over days, and the actual requirement (one fixed pattern plus a days-in-month check) is smaller than the dependency's surface. `d3-format` parses nothing — formatting only.
- `app/lib/db/ddl.ts` — `jsonTypeToDuckDb` already maps `number` → `DOUBLE` and date-formatted strings → `DATE`; the [projection](projection.md) owns how these column types reach DuckDB. Named here only to show the value shapes line up (finite double, ISO date string); this module never imports it.
- `app/lib/data-blocks/validate.ts` — `ValidationError` (`block`/`field`/`message`) is the shape asyncValidate ultimately emits; the table block maps `tableFailures` entries into it. This module returns plain data and never imports the validation layer — dependencies flow toward the generic.
- `app/lib/format/date.ts` — display-direction only (`formatDisplayDate` renders ISO for humans); the opposite of parsing, not reused.

Nothing in the repo currently parses user strings strictly; this module is new, and deliberately the only place the grammars live.

## Tests

**Skeleton.** This component's slice of the walking skeleton in [spec.md](spec.md): when a small pipe table is pasted, conversion feeds each column's raw cells to `inferColumnType` and the numeric column comes back `number`; the grid renders the result with zero red cells because every cell that inference counted as a parse also passes `parseCell`; the projection's SELECT returns typed rows because `parseCell` handed it a finite double and an ISO date string, not raw text. The slice proves the same grammar drives inference, rendering, and projection.

**Contract.** Given/when/then, riskiest first:

- Given `"1e309"` in a number column, when parsed, then the verdict is invalid — the double overflows to Infinity and non-finite fails.
- Given `"  42 "` in a number column, when parsed, then the verdict is valid 42 — surrounding whitespace trims; and given `"4 2"`, then invalid — interior whitespace does not.
- Given `"2026-13-45"`, `"2026-02-30"`, or `"2026-02-29"` in a date column, when parsed, then each is invalid — month range, day-in-month, and the leap rule are all enforced; given `"2024-02-29"`, then valid.
- Given `"0x10"`, `"007"`, `"1,000"`, `"+5"`, or `"Infinity"` in a number column, when parsed, then each is invalid; given `"1.000"`, then valid as the number 1.
- Given `"12/03/2026"`, `"2026-1-5"`, or `"2026-01-01T10:00"` in a date column, when parsed, then each is invalid — no ambiguous ordering, no unpadded fields, no time suffix.
- Given `""`, a missing key, or `"   "` under any type, when parsed, then the verdict is empty — not invalid, absent from `tableFailures`, excluded from inference's denominator.
- Given any non-empty string in a text column — including `"  padded  "` — when parsed, then the verdict is valid and the value is the raw string unchanged.
- Given a column whose non-empty cells are exactly half numbers, when inferred, then the type is `text` — exactly 50% does not clear more-than-half.
- Given an all-empty column, when inferred, then `text`; given a single non-empty cell `"7"`, then `number` — one of one is more than half.
- Given a column of three numbers and two dates among five non-empty cells, when inferred, then `number` — 60% clears the bar and dates cannot also clear it.
- Given a table with two invalid cells and several empty ones, when summarized, then `tableFailures` lists exactly the two invalid cells with their row index and column key, in table order — the projection's count is the list length, asyncValidate names both.

**Isolation.** The module is pure, so isolation is the whole story: plain vitest, table-driven with `it.each` over case arrays exactly as `app/lib/chart/format.test.ts` does, colocated as `app/lib/cells/parse.test.ts` and `app/lib/cells/infer.test.ts`. No mocks, no fixtures beyond inline strings — every contract case above is one row in a case table, and hostile strings are just more rows.
