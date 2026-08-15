# Grid renderer

The editable grid for `json-table` blocks: a new renderer kind `"table"` beside `"hidden" | "callout" | "chart"`, dispatched through the existing callout-blocks node-view path. The grid renders the block's rows and columns as an interactive table, marks cells that fail their column's type contract, and writes every edit back into the document as a full block update. It never talks to the database — the normal file-store save and debounced db sync carry changes to the projection (see [projection.md](projection.md)).

Block shape, key rules, and column-key generation live in [table-block.md](table-block.md). What "valid for type" means per cell lives in [cell-types.md](cell-types.md). How a pasted pipe table becomes a block lives in [conversion.md](conversion.md).

## Contract

### Renderer kind and dispatch

- `BlockTypeConfig.renderer` union in `app/lib/data-blocks/definition.ts` gains `"table"`.
- `isRenderedBlock` in `app/lib/editor/callout-blocks/plugin.ts` accepts `renderer === "table"` alongside `"callout"` and `"chart"`.
- `CalloutNodeView` in `app/lib/editor/callout-blocks/node-view.tsx` grows a table branch mirroring the chart branch: parse `node.textContent` with the table schema (from table-block.md's domain module), compute the caption index via the existing `collectCaptionEntries`/`findCaptionIndex` machinery with the block's `captionType` (`"Table"` — numbering independent of `"Figure"` because `findCaptionIndex` filters by caption type), wrap in `contentEditable={false}` with `data-id`, and render `TableBlockView`. Unparseable content falls through to the existing `CodeBlockFallback` invalid path; the draft-block `Building…` state applies unchanged.
- **Node-view lifetime**: the plugin currently recreates the node view on every node change (`update: (newNode) => !isRenderedBlock(newNode)` — rendered blocks return `false`, which tears down and re-mounts the React tree). Charts tolerate this; a grid does not — a re-mount after each cell commit drops focus and breaks Tab-to-next-cell. For table blocks the `update` callback must return `true` when the node is still a table block (same language), so React reconciles the existing view with the new node instead of re-mounting. This is a change to the shared plugin, scoped by renderer kind.

### The write-back side effect

There is no existing mechanism for a node view to replace a block's content. What exists today:

- `CalloutNodeView.handleDelete` dispatches a ProseMirror transaction (`tr.delete`) on the editor view; the doc change flows through the milkdown `markdownUpdated` listener in `app/ui/components/editor/MilkdownEditor.tsx` → `normalizeAsStored` → `onChange` → file store → debounced db sync. `prevContentRef` in the editor prevents the store's echo from firing a cursor-resetting `replaceAll`.
- `executeUxAction` (`app/lib/data-blocks/file-action.ts`) patches the raw file in the store directly via JSON-patch ops. Used by `FloatingToolbar`/`AnnotationHover`. **Rejected for the grid**: a raw-file write changes the editor's `defaultValue`, which fires `replaceAll` and resets cursor/selection — unusable mid-editing — and the edit bypasses the editor's history plugin, so undo would not see it.

**What must be added**: an `handleUpdate(next: TableBlock)` in `CalloutNodeView`, beside `handleDelete`, that serializes the block to JSON and dispatches a transaction replacing the code block node's text content (the range inside the node, `pos + 1` to `pos + node.nodeSize - 1`) with the new text. This keeps grid edits on the transaction path: they join the editor's undo history, ride `markdownUpdated` → file-store save → debounced sync, and re-render the node view with the new `node.textContent` (reconciled, not re-mounted, per the lifetime rule above). Serialization must match the stored block formatting so the store echo compares equal (same concern `normalizeAsStored` already handles for prose).

The grid performs exactly one doc write per committed edit — cell commit, row/column add, row/column delete, rename, type change. No per-keystroke writes.

### View / card split

Mirror the chart split: a view that does data work and owns all block transforms, and a presentational card.

**`TableBlockView`** (`app/lib/editor/table-blocks/view.tsx`) — props, each named by its consumer:

| Field          | Type                         | Consumer                                                                                             |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `data`         | `TableBlock`                 | source of truth for everything rendered; re-derived from `node.textContent` after every write-back   |
| `onUpdate`     | `(next: TableBlock) => void` | called with the full next block for every committed edit; `CalloutNodeView.handleUpdate` supplies it |
| `onDelete`     | `() => void`                 | whole-block delete button, same as charts; `CalloutNodeView.handleDelete` supplies it                |
| `captionType`  | `string \| undefined`        | caption formatting (`formatCaption` pattern from the chart view: `"Table n: label"`)                 |
| `captionIndex` | `number`                     | ditto; `0` suppresses the prefix, matching charts                                                    |

The view:

- reads `useIsReadOnly()` (as the chart view does) and passes `readOnly` down;
- computes `invalidCells: ReadonlySet<string>` (keyed `"<rowIndex>:<columnKey>"`) by running each cell through the cell-types validity check ([cell-types.md](cell-types.md)) against its column's declared type — pure and synchronous, no loading state;
- owns every block transform, calling the domain functions from table-block.md's module: add column (key generated per table-block.md's snake_case/dedup/`file`-reserved rule), delete column (strips that key from every row), rename column (`name` only, `key` untouched), set column type (only the `type` field changes — stored cell strings are never rewritten), add/delete row, edit cell. Each transform produces the next `TableBlock` and calls `onUpdate` once.

**`TableCard`** (`app/lib/editor/table-blocks/TableCard.tsx`) — presentational, no domain knowledge; props:

| Field             | Type                                   | Consumer                                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `columns`         | block's column list                    | header row rendering                                                                                                                                                                                                                     |
| `rows`            | block's row list                       | body rendering; cells read `row[column.key] ?? ""`                                                                                                                                                                                       |
| `invalidCells`    | `ReadonlySet<string>`                  | invalid styling on the matching cells                                                                                                                                                                                                    |
| `caption`         | `string \| undefined`                  | caption line below the grid, chart-card style; `undefined` when the label is empty — no caption line, no placeholder (the chart convention; converted tables arrive with an empty label and render captionless until someone names them) |
| `readOnly`        | `boolean`                              | suppresses every editing affordance                                                                                                                                                                                                      |
| `onEditCell`      | `(rowIndex, columnKey, value) => void` | cell commit                                                                                                                                                                                                                              |
| `onRenameColumn`  | `(columnKey, name) => void`            | header popover name field                                                                                                                                                                                                                |
| `onSetColumnType` | `(columnKey, type) => void`            | header popover type choice                                                                                                                                                                                                               |
| `onAddColumn`     | `(index, name) => void`                | fired once when a draft column's popover commits, carrying the committed name — the view generates the key from it; the draft itself never crosses this boundary                                                                         |
| `onDeleteColumn`  | `(columnKey) => void`                  | header popover delete action                                                                                                                                                                                                             |
| `onAddRow`        | `(index) => void`                      | row insertion affordance                                                                                                                                                                                                                 |
| `onDeleteRow`     | `(rowIndex) => void`                   | row-hover delete                                                                                                                                                                                                                         |
| `onDelete`        | `(() => void) \| undefined`            | card delete button; `undefined` in read-only, hiding it — the `ChartCard` convention                                                                                                                                                     |

The card's only state is the draft value of the currently focused cell, which header popover is open, and at most one uncommitted draft column (the add-column flow below). The block prop is the source of truth for everything else.

### Interaction model (spec level)

- **Cell editing**: a cell is a plain text input showing the stored string. Focus to edit; **commit on blur or Enter**; **Escape reverts** the draft to the stored value without a write; **Tab commits and moves focus to the next cell** in natural DOM order (Shift+Tab backwards). No arrow-key grid navigation, no drag anything — deliberately minimal.
- **Column header**: clicking a header cell opens a popover containing, top to bottom: a name text field (edits `name` only — commit on blur/Enter like a cell), the three type choices (text, number, date; current one marked), and a delete-column action. One affordance carries rename, retype, and delete. Changing type only re-evaluates validity; values are untouched.
- **Insertion points**: hovering the boundary between two columns (in the header) or two rows (at the row edge) reveals a `+` affordance at that spot; the ends of the grid always offer one. **Adding a column writes nothing at first**: the column appears at that index as a draft — default name `Column n`, its header popover open for naming — and exists only in the card's state. When the popover commits (blur or Enter on the name field), the key is generated from the committed name per [table-block.md](table-block.md)'s rule and the one `onUpdate` fires, carrying the new column; rows are untouched, since absent keys already mean NULL cells. **Escape is the only cancel**: clicking away commits, exactly as leaving a cell does, because one popover cannot both commit on blur and cancel on click-outside and those are the same gesture. A draft committed with a blank name is also cancelled, since the schema requires a name — no column, no write. This is what keeps table-block.md's "a column's key derives from the name at its first committed write" true: the block never holds a column with a provisional key. Adding a row inserts an empty row (all columns `""`), written immediately — rows carry no generated identity, so there is nothing to draft.
- **Row delete**: hovering a row reveals a delete affordance at the row's end.
- **Whole-block delete**: the card-corner delete button, identical to charts.
- **Focus on live conversion**: when [conversion.md](conversion.md)'s live path replaces a typed or pasted pipe table with a block, it marks the new block id in the shared `app/lib/editor/table-blocks/conversion-meta.ts`; the table branch of the node view claims that id once on mount and focuses the first body cell. The mark lives in that module rather than on the replacing transaction because a node view mounts after its node's transaction and cannot read its meta. This affordance is owned here — `TableCard` takes an `autoFocusFirstCell` boolean, true only for that first mount — so conversion's "focus lands in the grid" promise has a mechanism. Blocks mounted any other way (scroll into a doc, agent-created) never steal focus.

### Invalid-cell marking

A cell whose value fails its column's type contract renders with the repo's error token roles — the `TextField` error precedent (`app/ui/components/TextField.tsx`): the **`error-600` role** for the cell's border/inset ring, the **`error-50` role** for a background tint, and the **`error-700` role** if invalid text needs its own color. Token roles, not hexes — they resolve through `app/styles/theme.css`. Marking is visual only: input is never blocked, nothing is auto-corrected; the user fixes the value or asks the agent to. While a cell is focused and mid-edit the marking reflects the last committed value, not the draft.

### Empty states

- **Zero rows**: the header row renders with the row-insertion affordance below it. No placeholder text needed — the empty body plus the `+` is the state.
- **Zero columns**: the card body renders a single centered placeholder ("No columns") with an add-column affordance; caption and delete button still render. A zero-column block is still a valid rendered block — it never falls back to the raw code block (fallback is reserved for unparseable JSON).
- **Read-only + empty**: header only (zero rows) or the placeholder without the affordance (zero columns).

### Read-only

`useIsReadOnly()` true renders a static table: no inputs (cells are plain text), no insertion affordances, no header popovers, no row or block delete. Invalid cells stay marked — validity is information, not an editing affordance. The caption line still renders.

## Prior art

- **`app/lib/editor/chart-blocks/view.tsx` + `ChartCard.tsx`** — the split to mirror: view does data work and owns callbacks, card is presentational and hides its delete button when `onDelete` is undefined; `formatCaption` and the `captionType`/`captionIndex` plumbing come straight from here. Differences to not copy: no query, no sync subscription, no loading/empty/error state union — table data is synchronously present whenever the node view renders the grid.
- **`app/lib/editor/callout-blocks/node-view.tsx`** — the dispatch site: parse-per-renderer, `BlockSpacer`, `BuildingBlock` draft state, `CodeBlockFallback`, `handleDelete`'s transaction pattern (the model for the new `handleUpdate`), and the caption-index computation.
- **`app/lib/editor/callout-blocks/plugin.ts`** — where `"table"` joins the dispatch predicate, and where the node-view `update` lifetime rule lands.
- **`app/lib/data-blocks/file-action.ts` (`executeUxAction`)** — the other write path, rejected above for in-editor use (cursor-resetting `replaceAll`, bypasses undo history).
- **`@milkdown/components` table-block** — REJECTED: it edits gfm pipe-table _nodes_ in the prosemirror doc; our tables are fenced data _blocks_ with keys and typed columns, not markdown table syntax.
- **`app/lib/editor/chart-blocks/QueryResultsTable.tsx`** — an existing read-only table rendering inside a card; visual reference for the static read-only grid.

## Tests

### Skeleton

This component's slice of the walking skeleton (the paste half lives in [conversion.md](conversion.md)): a document whose content contains a `json-table` fenced block, mounted in the real `MilkdownEditor`, renders a grid — header cells show column names, body cells show row values — instead of a code block. Editing one cell and committing fires the editor's `onChange` with markdown in which the block's JSON carries the new value and nothing else changed. That proves dispatch, parse, render, and the write-back transaction end to end.

### Contract

Given/when/then, riskiest first.

1. **Invalid-cell marking** — given a column typed `number` and a row whose cell holds a non-parsing string (per cell-types.md), when the grid renders, then that cell carries the error-token marking and every conforming cell does not; the input is still focusable and editable.
2. **Column delete strips keys** — given three columns and rows carrying values under all three keys, when the user deletes the middle column via its header popover, then `onUpdate` receives a block whose `columns` lacks it and whose every row lacks that key — no orphaned values.
3. **Add-column drafts until commit** — given an existing column named "Score" (key `score`), when a column is added and its popover committed with the name "Score", then exactly one `onUpdate` fires, the new column's key is the deduped variant per table-block.md's rule, the existing column's key is unchanged, and rows are untouched; when instead the popover is dismissed with Escape, then no `onUpdate` fires and the block has no new column.
4. **Type change re-marks without rewriting** — given a `text` column holding `"2024-01-15"` and `"hello"`, when its type is set to `date` via the header popover, then `onUpdate` receives a block where only that column's `type` changed — every cell string is byte-identical — and on re-render `"hello"` is marked invalid while `"2024-01-15"` is not.
5. **Read-only blocks all editing** — given `useIsReadOnly()` true, when the grid renders, then no cell is an input, no insertion affordance, header popover, row delete, or block delete exists, and invalid cells remain marked.
6. **Cell commit semantics** — editing a cell then blurring (or Enter) fires `onUpdate` exactly once with only that cell changed; Escape after typing fires no `onUpdate` and restores the stored value; Tab commits and focus lands on the next cell.
7. **Rename edits name only** — committing a new header name fires `onUpdate` with that column's `name` changed and its `key` identical; rows are untouched.
8. **Add row at chosen spot** — the insertion affordance between row 1 and row 2 produces a block whose new empty row sits at index 1, written immediately. A column's insertion affordance produces no block change by itself — it opens the draft, and the write happens at popover commit per case 3, with the column landing at the affordance's index.
9. **One write per edit** — a single committed edit of any kind produces exactly one `onUpdate` call (guards against per-keystroke writes).
10. **Happy paths** — a well-formed block renders all rows/columns in order; caption renders as `"Table n: label"` when `captionIndex > 0` and as the bare label when `0`; block delete fires `onDelete`.

Transform logic (delete-strips-keys, key generation, type-change purity) belongs to table-block.md's domain module and is contract-tested there; here those cases are tested at the view boundary — affordance in, `onUpdate` payload out.

### Isolation

Storybook stories run through vitest, the repo's component layer (`.storybook/vitest.setup.ts`; `play` functions with `storybook/test`'s `expect`/`userEvent`/`within`/`fn`). Mirror `ChartCard.stories.tsx` and `AxisChart.stories.tsx`:

- **`TableCard.stories.tsx`** under `Custom/Tables/TableCard`, `withSize` decorator for a fixed card width. Stories: `Ready` (well-formed fixture, asserts header and cell text), `InvalidCells` (asserts error-token class on the failing cell only), `ZeroRows`, `ZeroColumns`, `ReadOnly` (asserts absence of inputs and affordances), `HeaderPopover` (open via click, assert name field, type choices, delete action), `CellCommit` / `CellEscape` / `TabMoves` (`fn()` spies on `onEditCell`, assert call counts and payloads), `AddColumnCommit` (open the draft at an index, type a name, commit — spy asserts one `onAddColumn(index, name)` call; Escape asserts none) / `DeleteRow` (spy on the structural callback), `WithCaption`, `WithDelete` / `WithoutDelete` (the `ChartCard` pair, delete hidden when `onDelete` is undefined).
- Fixtures come from a `test-helpers` module beside the table domain code (the `chartFixture` pattern), so stories and contract tests share one canonical block.
- The `renderVariantMatrix` helper (`.storybook/matrix.tsx`) is available if a cell-state matrix (valid/invalid × text/number/date × editable/read-only) earns a single visual-sweep story; keep it to one matrix story at most.
- `TableBlockView` needs no story of its own — it has no async states; its behavior is covered by the contract layer and the skeleton.
