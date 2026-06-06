# ARCHITECTURE — nabu-theatron (nabu-ezida)

> Snapshot in time. The repo evolves; this map will rot. When something here disagrees with the code, trust the code.

## 1. Mental model in one breath

Nabu is an **Integrated Research Environment**. The unit of truth is a **markdown file with JSON code blocks embedded in it**. The markdown is for humans and LLMs; the JSON blocks are the source of truth for structured data (callouts, charts, annotations, settings, attributes).

Everything else is derived from those files:

```
.md files (raw text on disk / in store)
   ↓ parse + validate (ZOD)
parsed Block[] + prose
   ↓ project (ZOD → DDL → rows)
DuckDB tables (for LLM SQL + chart queries)
   ↓ embed
EmbeddingsCache (for semantic search)
   ↓ render
ProseMirror nodes (callout / chart React node-views, hidden singletons)
   ↓ resolve entity hrefs
EntityLink pills (clickable, colored, icon'd)
```

Writes flow back through one funnel: **patches → validation → file store update → derived state refresh**. There are two patch sources (user and LLM), and they differ in trust level (see §6).

---

## 2. Top-level layout (and the dependency rule)

Per **R-VII** in CLAUDE.md: `lib` imports nothing above it; `domain` imports `lib`; `ui`/`routes` import both.

```
app/
  lib/        — engines, no domain knowledge (mostly generic <T>)
  domain/     — block type configs, selectors, business logic
  ui/         — React components, hooks, layouts, theme
  routes/     — React Router 7 page-level entry points
  designs/    — Subframe-generated design components
  styles/
  root.tsx
  routes.ts
scripts/      — bench-deep-analysis.ts, bench-run.sh
hermes-logos/ — (sibling repo) prompts, agents, schemas — NOT this repo
```

Inside `lib/`, the major sub-engines:

| Folder                                                                                         | Role                                                                                                     |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `agent/`                                                                                       | LLM communication, tool definitions, agent loop, nudges, derived state                                   |
| `data-blocks/`                                                                                 | Block parsing, validation, registry, typed-ops, migrations, ID handling                                  |
| `patch/`                                                                                       | Unified-diff parsing, fuzzy resolution, structured-JSON ops, application                                 |
| `files/`                                                                                       | The file store (raw markdown), subscriptions, pending-refs, hidden-blocks                                |
| `db/`                                                                                          | DuckDB-WASM init, DDL generation, projection, sync, Arrow bulk insert                                    |
| `search/`                                                                                      | Pipeline (resolve → execute → filter), HyDEs, fusion (RRF), slices                                       |
| `embeddings/`                                                                                  | Embedding API client, batching, caching                                                                  |
| `editor/`                                                                                      | Milkdown plugins: callout-blocks, chart-blocks, hidden-blocks, annotations, gutter, selection, spotlight |
| `markdown/`                                                                                    | Prepare, sanitize, resolve, linkify (entity-link pills)                                                  |
| `sql/`                                                                                         | LLM SQL normalization (`normalize.ts`) and safety rejection (`reject.ts`)                                |
| `mutation-history/`                                                                            | Diffs and history log of LLM mutations (codes/tags/annotations/prose)                                    |
| `server/`                                                                                      | API queries + sync/websocket commands (apply, gzip)                                                      |
| `composite/`, `text/`, `format/`, `fp/`, `language/`, `utils/`, `chart/`, `import/`, `corpus/` | Generic utilities                                                                                        |

Inside `domain/`:

| Folder                                                            | Role                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `data-blocks/{type}/definition.ts` + `schema.ts` + `selectors.ts` | Per-block-type ZOD schemas and config                                   |
| `data-blocks/migrations/`                                         | Shape-detection migrations (extract-annotations, wrap-annotations)      |
| `data-blocks/prose-registry.ts`                                   | block-type → prose converter (only callout has one)                     |
| `data-blocks/entity-ids.ts`                                       | Collect all known entity IDs across the file store                      |
| `db/projections.ts`, `db/database.ts`                             | Glue: BlockTypeConfig → ProjectionConfig → DDL                          |
| `search/queries.ts`, `search/context.ts`, `search/execute.ts`     | Domain-level search wrappers                                            |
| `embeddings/init.ts`, `embeddings/schema.ts`                      | Embedding setup                                                         |
| `corpus/`                                                         | Topic assignment, prose extraction, semantic context for queries        |
| `exhibits/`                                                       | Aggregate view of charts as exhibits (sidebar)                          |
| `actions/`                                                        | High-level user workflows: `coding/`, `clear-codings/`, `select-codes/` |

---

## 3. The block system — the heart

### 3.1 The `BlockTypeConfig` interface

`app/lib/data-blocks/definition.ts:28-50` — **the single contract**:

```ts
interface BlockTypeConfig<T = unknown> {
  schema: (ctx?: ValidationContext) => z.ZodType<T>
  readonly: string[]
  immutable: Record<string, string> // field → human reason
  constraints: string[]
  renderer: "hidden" | "callout" | "chart"
  singleton: boolean
  projected?: boolean
  tableName?: string // DuckDB table name
  allowedFiles?: string[] // restrict to certain .md files
  labelKey?: string // which field is the label
  captionType?: string
  idPaths?: { path: string; prefix: string }[]
  actorPaths?: { path: string }[]
  fuzzyFields?: string[]
  normalizeAsFile?: string[]
  patchSchema?: (schema) => schema // mutate JSON schema for patching
  rowPath?: string // project array element rows
  expandIdRefs?: { field; prefix; replaceWith }[]
  asyncValidate?: (parsed, ctx) => Promise<ValidationError[]>
  normalize?: (oldDoc, newDoc) => unknown
}
```

There is **no `defineBlock()` registration function**. Block configs are imported by name into `app/lib/data-blocks/registry.ts:14-21` and added to one record. To add a new block type, you write `domain/data-blocks/<type>/{schema,definition}.ts` and add a line to the registry.

### 3.2 The six block types

| Language           | Singleton | Renderer | Projected | Table        | ID prefix(es)                       | Source                            |
| ------------------ | --------- | -------- | --------- | ------------ | ----------------------------------- | --------------------------------- |
| `json-attributes`  | yes       | hidden   | yes       | (block name) | —                                   | `domain/data-blocks/attributes/`  |
| `json-settings`    | yes       | hidden   | yes       | (block name) | `tag`, `search` (per nested idPath) | `domain/data-blocks/settings/`    |
| `json-annotations` | yes       | hidden   | yes       | (block name) | `annotation` (nested)               | `domain/data-blocks/annotations/` |
| `json-callout`     | no        | callout  | yes       | `callouts`   | `callout`                           | `domain/data-blocks/callout/`     |
| `json-chart`       | no        | chart    | no        | —            | `chart`                             | `domain/data-blocks/chart/`       |
| `json-ux`          | yes       | hidden   | no        | —            | —                                   | `domain/data-blocks/ux/`          |

`singleton: true` → one block per file; if user has multiple, validation fails. Stripped before word-count (`stripSingletonBlocks` in `registry.ts:40`).

`renderer: "hidden"` → DOM-decorated `display: none` in the editor (`lib/editor/hidden-blocks/plugin.ts:19`) but still in the markdown.

`renderer: "callout" | "chart"` → ProseMirror node view, rendered as a React component at its position.

### 3.3 The parse → validate → normalize → migrate pipeline

Sequence (from `lib/data-blocks/validate.ts`):

1. `parse.ts::parseCodeBlocks` — extract code blocks by language
2. `validate-fences.ts::validateFences` — balanced ``` markers
3. `validate.ts` — singleton constraint (only one allowed per file)
4. ZOD `schema.safeParse(parsed)` — per-block schema validation
5. `BlockTypeConfig.asyncValidate?` — async hook (e.g., chart query validation)
6. `normalize.ts` — whitespace/order/field normalization (called separately, e.g., post-patch)
7. `migrate.ts` — shape-detection migrations applied on read; see `domain/data-blocks/migrations/`

Two-tier validate: `field-validate.ts::emptyToUndefined` is a tiny ZOD preprocessor helper for empty-string handling, not a separate validator.

### 3.4 IDs

ID format: `{prefix}-{value}` (e.g., `callout-abc123`, `annotation-xyz`).

Prefixes are declared per block via `idPaths[].prefix` (multiple paths allowed for nested arrays).

- Mint: `lib/data-blocks/uuid.ts` + `ids.ts`
- Collect known IDs: `domain/data-blocks/entity-ids.ts::getKnownEntityIds(files)` — walks callouts, annotations, charts, tags, searches
- Find block config by prefix: `registry.ts::findBlockConfigByPrefix`
- Extract from text/SQL: `lib/data-blocks/ids.ts::extractEntityIdsFromSql`
- All prefixes at once: `registry.ts::getEntityPrefixes`

### 3.5 Typed-ops — the LLM patch dialect

`lib/data-blocks/typed-ops/` exposes a higher-level operation language for the LLM than raw RFC 6902 JSON Patch:

- `derive.ts` — given a `BlockTypeConfig`, analyze its ZOD schema and produce `TypedOpsSpec` (which fields are settable, which arrays support add/setItem/remove, which are fuzzy/multiline/immutable).
- `translate.ts` — convert LLM operations like `{op:"add_callout", item:{...}}` or `{op:"set_callout", match:{id}, fields:{...}}` into a list of JSON Patch ops.

This is what `block-tools` (the auto-generated `patch_*`, `add_*`, `delete_*`, `move_*` tools) calls behind the scenes.

### 3.6 Registry

The block-type registry (`lib/data-blocks/registry.ts`) is what every block-aware engine consults to enumerate types, look up configs, find by prefix, etc.

There used to be a separate `domain/data-blocks/prose-registry.ts` that mapped block types → "prose representation" functions (only `json-callout` had one). It was used by the embedding and corpus pipelines to inline callout prose into the embedded text. That registry has been deleted: embedding source is now `extractProse(file)` (drops all code blocks, prose only). See §8.1.

---

## 4. ZOD as the source of truth — what gets generated

| Target                          | How it's generated                                                                                              | Where                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| JSON Schema for LLM tool params | `z.toJSONSchema()` + actor/readonly stripping                                                                   | `lib/data-blocks/json-schema.ts::toBlockSchema`                 |
| DuckDB DDL                      | JSON Schema → typed columns + child tables                                                                      | `lib/db/ddl.ts::jsonSchemaToTableProjection`, `projectionToDdl` |
| Per-block patch tools           | `block-tools/generate.ts` walks registry, builds `patch_*` / `add_*` / `delete_*` / `move_*` tools per language | `lib/agent/tools/block-tools/`                                  |
| LLM op → JSON Patch             | `typed-ops/translate.ts`                                                                                        | `lib/data-blocks/typed-ops/`                                    |
| Strict-mode tool schemas        | `executors/strict-schema.ts` checks Claude strict-compatibility                                                 | `lib/agent/executors/`                                          |

So **the ZOD schema in `domain/data-blocks/{type}/schema.ts` is the only place a field's type is declared**. Everything else — JSON Schema, DDL, available patch operations, LLM tool param schemas — is downstream.

---

## 5. Files store

`app/lib/files/`:

- `store.ts` — central in-memory file store, `updateFileRaw(path, content)`, `subscribe(listener)`, debouncing knobs (`immediate`, `skipPendingRefs`)
- `selectors.ts` — get raw text by path, list files, etc.
- `hidden-blocks.ts` — strip hidden-block raw text for prose-only views
- `filename.ts` — path utilities
- `subscribe-content.ts` — content-only subscriptions (skip metadata changes)
- `pending-refs/` — tracks "in-flight" references that haven't materialized yet (likely guards against dangling references during multi-step LLM mutations)
- `collect.ts` — gather views across files
- `write-tracked.ts` — mark which files have been written (for sync)

Server-side persistence is in `lib/server/`: `api/queries.ts` (HTTP API) and `sync/` (websocket: `apply.ts`, `commands.ts`, `gzip.ts`, `websocket.ts`, `types.ts`).

---

## 6. The patch system — user vs. LLM paths

> This is the most safety-critical piece. Almost every write goes through it.

### 6.1 The two shapes

There is no single "PatchSpec". Patches live at two levels:

- **File level**: unified diff strings (`@@ ... @@` hunks). All `update_file` operations are diffs.
- **Block level**: `JsonPatchOp[]` from `fast-json-patch` (RFC 6902). All structured-JSON writes inside a block are these.

A high-level user mutation is a `FilePatch` (`lib/data-blocks/file-action.ts:6-12`) — `{ path, language, ops, blockId?, overrideFuzzyFields? }`. The LLM equivalent is a discriminated `Operation` in `lib/agent/tools/apply-local-patch/def.ts:3-36` — `create_file | update_file | write_file | delete_file | rename_file | copy_file`.

### 6.2 USER patch trace

```
UI action (e.g., select-codes button)
  → domain/actions/select-codes/apply.ts
    → executeUxAction(patches: FilePatch[])
      → lib/data-blocks/file-action.ts::executeFileAction({ patches, immediate: true, skipPendingRefs: true })
        for each patch:
          → lib/data-blocks/patch.ts::patchBlockContent(raw, language, ops, blockId, overrideFuzzyFields)
            → lib/patch/structured-json/pipeline.ts::applyEnrichedOps
              → fast-json-patch::applyPatch
        → lib/data-blocks/actor.ts::stampActor(..., "user")
        → lib/files/store.ts::updateFileRaw (immediate, skipPendingRefs)
```

**What user patches skip:**

- ID-existence checks (the typed-ops layer is more permissive)
- The unified-diff / fuzzy / range-expand pipeline (they go straight to block JSON)
- `mutation-history` recording (no `pushEntries()`)
- Async validation (the immediate flush + `skipPendingRefs: true` bypass it)

**Why**: user mutations are already interactive — the UI guarantees the block exists, the user is the trust source, and the editor's undo/redo handles history.

### 6.3 LLM patch trace

```
LLM tool call: apply_local_patch({ operation })
  → lib/agent/tools/apply-local-patch/handler.ts
    validateOperation()          — file exists, not protected
    detectBlockCreations()       — reject new JSON blocks (must use block-tools)
    detectBlockTouches()         — reject modifications inside existing JSON blocks
  → lib/agent/executors/execute.ts::applyMutation
    redirectGeneratedOp()        — redirect generated.hidden.md
    checkHiddenFileGuard()       — reject hidden-file edits
    switch on op type:
      create_file → applyFilePatch(path, "", diff, { actor: "ai" })
      update_file → applyFilePatch(path, oldContent, diff, { skipImmutableCheck, actor: "ai" })
      write_file  → finalizeContent(...)
  → lib/patch/apply.ts::applyFilePatch
    resolve/range-expand.ts      — +<< file.md / start / end markers
    resolve/fuzzy-match.ts       — FUZZY[[text]] placeholders
    resolve/json-boundary.ts     — inject/strip JSON block boundary comments for matching
    diff/parse.ts → apply hunks
  → lib/patch/apply.ts::finalizeContent
    fill missing block IDs
    stamp actor ("ai")
    fence alignment
    ZOD validate every block in the file
    dangling tag check (if settings.md)
  → updateFileRaw(path, result.content)
  → runAsyncValidation()
  → mutation-history/store.ts::pushEntries(diffFileContent(old, new, path, ts))
```

**The LLM path is fully audited**: full diff, full ZOD revalidation, plus a `mutation-history` entry per change (the diff is decomposed by `diffCodes`, `diffTags`, `diffAnnotations`, `diffProse`).

### 6.4 Patch subsystems

| Folder                           | Role                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/patch/diff/`                | `parse.ts` (unified diff → hunk AST), `search.ts` (context fuzzy match), `zone.ts` (zone tracking)                                      |
| `lib/patch/resolve/`             | `fuzzy-match.ts` (FUZZY[[...]] resolution), `range-expand.ts` (cross-file range refs), `json-boundary.ts` (JSON block boundary marking) |
| `lib/patch/structured-json/`     | `apply.ts` (fast-json-patch wrapper), `pipeline.ts` (per-op application with partial-success retry, fuzzy field matching, array dedup)  |
| `lib/patch/apply.ts`             | The top-level entrypoint: `applyFilePatch`, `finalizeContent`                                                                           |
| `lib/patch/scenarios/`           | Golden fixtures (`valid/`, `invalid/`) for snapshot-style tests                                                                         |
| `lib/data-blocks/patch.ts`       | `patchBlockContent` — block-aware JSON op application                                                                                   |
| `lib/data-blocks/file-action.ts` | `FilePatch` type + `executeFileAction` — UX-side patch entry point                                                                      |
| `lib/mutation-history/`          | `store.ts`, `diff.ts`, `differs/` (codes, tags, annotations, prose) — LLM-only audit log                                                |

**`fast-json-patch`** is used exactly once: `lib/patch/structured-json/apply.ts:1`.

### 6.5 Domain actions vs. patch primitives

`domain/actions/{coding, clear-codings, select-codes}/` are **workflow orchestrators**, not patch primitives. `select-codes/apply.ts` builds a `FilePatch` and calls `executeUxAction`; `coding/actions.ts` builds a TaskConfig the AI consumes (it eventually invokes `apply_deep_analysis`).

---

## 7. DuckDB projection

DuckDB runs **client-side as WASM**. No server-side DB.

### 7.1 Bootstrap

`domain/db/database.ts::startDatabase`:

1. `buildProjectionsWithSchemas()` — walk registry, build `ProjectionConfig[]`
2. `generateDdl()` — `lib/db/ddl.ts::projectionToDdl` traverses each block schema, produces `CREATE OR REPLACE TABLE` SQL
3. `lib/db/init.ts::initializeDatabase(ddl)` — load `duckdb-mvp.wasm` / `duckdb-eh.wasm` in a Web Worker, run the DDL
4. Initial sync (`syncOnce`)
5. Background sync via `subscribe(fileStore, debounced(200ms))`

### 7.2 ZOD → DDL

`lib/db/ddl.ts`:

- `jsonTypeToDuckDb` maps JSON Schema types → DuckDB types (`string`→`VARCHAR`, `integer`→`INTEGER`, `date`→`DATE`, arrays of scalar → `<T>[]`)
- `buildColumns` flattens nested objects: `metadata.created` → column `metadata_created VARCHAR`
- `findChildTables` finds object-array fields → separate child tables; child rows get a `file` foreign-key column
- Every table has `file` (NOT NULL)

Example (from `ddl.test.ts`): a `settings` block with `tags: [{id, label}]` →

- `settings` table (just `file`, since the wrapper has no scalar fields)
- `settings_tags` child table with `(file, id, label)`

For singletons with `rowPath` set (e.g., `json-annotations` with `rowPath: "annotations"`), the **array elements become the rows**, not the wrapper.

`hiddenColumns` (e.g., `["hash", "embedding"]` on the embeddings projection) and `expose?: boolean` on a `BlockTypeConfig` control what the LLM sees of the schema.

### 7.3 Sync

`lib/db/sync.ts`:

1. `computeSyncPlan(prev, next)` — string-compare file contents → `{deleted, changed}`
2. `batchSyncPlan(plan, 20)` — chunks of 20 files
3. For each file: parse blocks, `extract.ts::extractRows` walks the schema, produces flat rows for every (sub-)table
4. Delete-then-insert per (file, table)
5. Inserts go via Apache Arrow: `lib/db/arrow.ts::rowsToArrowTable` → `conn.insertArrowTable`

### 7.4 LLM query path

The `query` tool (`lib/agent/tools/query/`) runs raw SQL against this DB. Safety:

- `lib/sql/normalize.ts::normalizeLlmSql` — fix LLM quote/escape mistakes
- `lib/sql/reject.ts` — block `CASE` expressions and string-formatting functions (force the LLM to return raw columns; styling happens in UI)
- `lib/agent/tools/sql-describe.ts` — system-prompt guidance, including the `SEMANTIC()` extension for embedding queries

> **For UX, skip the DB.** Use selectors directly on parsed blocks (`domain/data-blocks/*/selectors.ts`). The DB is for ad-hoc LLM SQL and chart queries.

---

## 8. Search pipeline

End-to-end entry points:

- User: `routes/project.search.tsx` → `useSearchResults()` → `lib/search/pipeline.ts::runSearchPipeline`
- LLM: `lib/agent/tools/search/handler.ts::handleSearch` → same pipeline, then saves the search via `saveNewSearch()`

### 8.1 Mental model — chunks as probes, regions as results

Chunks of `extractProse(file)` are stored as embedding vectors with their byte offsets (`chunkStart`, `chunkEnd`). They are **probes**: ways to find candidate regions of the source. A search **hit** is a region of the source — not a chunk. Multiple probes hitting overlapping bytes collapse into one region. The LLM sees source-slice text, never chunk-text. This eliminates the "chunk universe vs prose universe" mismatch and the "section becomes entire file" failure mode that the old `trimAroundMatches`-based locate had.

The same source representation is used everywhere downstream: embedding source = corpus excerpt source = region slice source = `extractProse(file)`. No `toEmbeddableText`, no `toProseFns`, no callout inlining.

### 8.2 The pipeline file is the map

`lib/search/pipeline.ts` is a thin chain. The top-of-file comment is the literal map:

```
probe                → SearchHit[]   (Stage 1)
capStage             → SearchHit[]   (Stage 2)                          always — limiting, not merging
mergeStage           → SearchHit[]   (Stage 3)  [skipMerge]
verdict              → SearchHit[]   (Stage 4)  [skipFilter]            streaming, batched, async
trim                 → SearchHit[]   (Stage 5)  [skipTrim]
extendForAnnotations → SearchHit[]   (Stage 6)  [skipAnnotationExtend]
```

Each stage lives in its own file. Toggles short-circuit the stage to identity. `verdict` is the only async/batched/streaming step; per-batch tail (`trim` → `extendForAnnotations`) fires through `onResults` as batches complete.

`runSearchPipeline(sql, highlight, ctx, files, target, onResults?)`:

**Stage 0 — Resolve semantic** (`lib/search/resolve-semantic.ts`)

- Extract `SEMANTIC(...)` tokens from the SQL (`semantic.ts::extractSemanticTokens`)
- Determine significant languages from the corpus (>10% of files by language)
- For each (language × query token) generate **3 HyDEs** (hypothetical document embeddings) — short LLM-generated passages that would answer the query. Cached in `EmbeddingsCache` keyed by source-hash + language set.
- `generateHydesForDescription` (corpus-aware) and `generateGenericHydes` (language-only) feed into the `/hyde-generator` endpoint
- Embed each HyDE via `fetchEmbeddingBatch` → `/embeddings`

**Stage 1 — Probe** (`lib/search/probe.ts`)

- Wraps `execute.ts::executeSearch` (plain SQL) / `executeHybridLocal` (semantic, RRF-fused).
- Cosine query rewriting: `semantic.ts::buildCosineBase` auto-injects `chunkStart, chunkEnd, list_cosine_similarity(...) AS _semantic_score` into the SELECT list — so any cosine query returns offsets regardless of how it was written. Hydes fan out, each runs `ORDER BY _semantic_score DESC LIMIT 200`. Then `fusion.ts::fuseCosineResults` Reciprocal Rank Fusion (`k=60`) into a single sorted list.
- Output: `SearchHit{file, chunkStart, chunkEnd, score, text}` sorted by RRF score desc. `text` = `source.slice(chunkStart, chunkEnd)`.

**Stage 2 — Cap** (`lib/search/cap.ts`)

- **Always runs** — limiting, not merging. Prevents one noisy file from flooding the LLM filter.
- `capByFile`: walk hits by score desc; for each file, accept while `accepted_count < cap`, otherwise skip. `cap = min(total_chunks, max(FLOOR, ceil(RATIO × total_chunks)))` — defaults `FLOOR=10`, `RATIO=0.5`. Total chunks per file come from `source.ts::getTotalChunks` (counts companion `json-embeddings` blocks).
- `capStage(hits, files)` is the pipeline entry: builds the per-file totals map then calls `capByFile`.
- No skip toggle — capping is structural, not optional.

**Stage 3 — Merge (seed-and-grow)** (`lib/search/merge.ts`)

- `seedAndGrow`: walk hits in input order (RRF rank desc, preserved through cap). Per file, maintain a list of regions `{start, end, anchor}`. For each new hit:
  - **0 byte-overlapping regions** → seed a new region anchored on the hit.
  - **1 byte-overlapping region** → apply the score-ratio gate. If `hit.score / region.anchor.score >= DEFAULT_SEED_GATE_RATIO` (= 0.6): extend `region.start/end` to swallow the hit. Otherwise: hit is consumed and dropped (cannot seed elsewhere, cannot dilute the region).
  - **2+ byte-overlapping regions** → hit bridges two seeds, dropped unconditionally. No region fusion.
- Anchor never swaps: walking in rank order means the seed is always the rank-best constituent. All later admissions are equal or worse rank; the gate compares them against the seed.
- Byte-overlap test = ranges intersect or touch: `hit.chunkStart <= region.end && hit.chunkEnd >= region.start`.
- No region byte-overlaps another region. Bridging is forbidden by construction.
- `toRegions`: re-slice each grown region from `getEmbeddableSource(file, files)` (= `extractProse(file)`). Source-anchored text, not chunk text.
- `mergeStage(hits, files) = toRegions(seedAndGrow(hits), files)`.
- Skip toggle: `skipMerge` — pass capped chunk hits straight through, LLM sees one chunk per region. (When skipped, regions can byte-overlap freely — the gate isn't running.)
- Knob: `DEFAULT_SEED_GATE_RATIO = 0.6`. Lower = more permissive (weak neighbors join), higher = tighter regions. No corpus-independent guarantee; pragmatic default for research-document corpora where RRF scores are wavey.

**Stage 4 — Verdict (LLM filter)** (`lib/search/verdict.ts`)

- For each region, send `region.text` (source slice) to `/semantic-filter` as a numbered passage. Two-model run (`FILTER_RUNS=2`) batched by `FILTER_BATCH_SIZE=5`, parallelized via `processPool` at `FILTER_CONCURRENCY=5`. Per-model cache keyed by (model index, intent, signals, numbered-passage).
- LLM returns sentence-index ranges within the region. Attached as `hit.matchRanges` (0-based `{start, end}` per range). Derives `hit.matches` (joined sentence text — kept for editor underline) via `extractMatchTexts`.
- Drops hits the LLM rejected (empty match groups). Streams approved batches via `onBatch` callback.
- Overselection guard: if matches cover > `MAX_SELECTED_RATIO = 0.4` of the region's sentences, that run is discarded as too greedy.
- Pool stops early on `target` reached or `maxBarren` consecutive empty batches.
- Skip toggle: `skipFilter`.

**Stage 5 — Trim** (`lib/search/trim.ts`)

- `flatMap` over hits. For each hit with `matchRanges`: apply `text/trim-around.ts::trimByRanges(hit.text, matchRanges)` to keep only the picked sentences with context shoulders (`mergeRanges` → `mergeClose` → `renderRegion`).
- Splits one hit into multiple regions when matchRanges are far apart (separated by `SEPARATOR`).
- Skip toggle: `skipTrim`.

**Stage 6 — Annotation extend** (`lib/search/extend-annotations.ts`)

- For each hit: resolve each visible file annotation's text to a byte range via `findMatchOffset(source, ann.text)`.
- `extendAndCollect`:
  - If an annotation range partially intersects `[hit.chunkStart, hit.chunkEnd]`, extend the hit to swallow the full annotation.
  - Collect every annotation whose offset intersects the extended range (including ones entirely inside the original range).
- Re-slice `hit.text` from source by the extended range, then append a ` ```json-annotations\n{...}\n``` ` block listing the collected annotations so the LLM filter sees which codings live in this region.
- Annotations entirely outside the hit produce no change. Annotations referencing text inside a code block (stripped from source) silently miss — acceptable; they weren't searchable anyway.
- Skip toggle: `skipAnnotationExtend`.

**Paging** (`lib/search/paging.ts`): LIMIT/OFFSET rewrites for streaming. Applies at the SQL boundary, not part of the chain.

### 8.3 Uniform output shape

Every stage emits the same shape:

```
SearchHit { file, chunkStart?, chunkEnd?, score?, text?, matches?, matchRanges? }
```

Render layer reads `text` and highlights `matches` if present. Identical handling for every stage's output. Each skip toggle hands the previous stage's output straight to render.

### 8.4 Chunk storage

`lib/embeddings/chunk.ts::chunkText(text)` slides a `CHUNK_CHARS = 1600` window with `CHUNK_STRIDE_CHARS = 1280` (20% overlap), aligning cuts to whitespace within `CHUNK_WORD_TOLERANCE = 160`. Emits `Chunk { index, text, hash, chunkStart, chunkEnd }`. Offsets are byte positions in `text.trim()`, shifted by leading-whitespace count back to original-source coordinates.

The overlap exists for **recall** (boundary semantics), not dedup. Regions handle dedup structurally — `seedAndGrow` swallows byte-overlapping rank-close hits into one region and drops the rest, so chunk-overlap never produces duplicate regions. Chunk overlap could be tuned independently; the pipeline is correct for any stride.

Companion file `<name>.embeddings.hidden.md` stores `EmbeddingEntry { hash, text, embedding, chunkStart, chunkEnd, language? }` per `json-embeddings` block. `diffChunks` re-stamps `chunkStart`/`chunkEnd` from the current chunk onto kept entries on every sync, so offsets stay fresh even when the embedding vector itself is unchanged.

### 8.5 Embeddings table (DuckDB)

- Projection name `files` (`tableName: "files"`), language `json-embeddings`. Schema is `EmbeddingRowSchema` (`domain/embeddings/schema.ts`) → DDL auto-derived.
- Hidden from LLM-facing schema: `hash`, `embedding`. Visible: `file`, `text`, `chunkStart`, `chunkEnd`, `language`.
- `fileMapper` maps `<name>.embeddings.hidden.md` → `<name>.md` so joins work.

### 8.6 Source slice helper

`lib/search/source.ts::getEmbeddableSource(file, files)` returns `extractProse(files[file])` with a content-keyed cap-cache (500 entries). `sliceSource(source, start, end) = source.slice(start, end)`. `getTotalChunks(file, files)` counts companion `json-embeddings` blocks via `fastParseBlockContents` (with a 500-entry cap-cache).

### 8.7 Parallelism

- HyDE generation: `processPool()` with warmup
- Filter: `filterParallel` batches (size 5, concurrency 5)
- Hit refresh: `slices.ts::refreshHitsAsync` yields to the browser between hits (`yieldToBrowser()`) so the UI stays responsive on large result sets

### 8.8 Intent

`lib/search/intent.ts::generateSearchIntent` is a separate query-understanding LLM step (its product is a structured intent, not a HyDE).

### 8.9 `format-hydes.ts`

Debug output for HyDE queries — surfaces what passages were generated and embedded for each query.

### 8.10 Debug toggles

`isDebugOn(key)` from `lib/debug/options.ts`. UI list in `ui/components/editor/debug-config.tsx`:

| Toggle                   | Effect                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| `skipMerge`              | Stage 3 bypassed — capped chunk hits go straight to verdict, no byte-fuse |
| `skipFilter`             | Stage 4 bypassed — render Stage 3 regions as-is                           |
| `skipTrim`               | Stage 5 bypassed                                                          |
| `skipAnnotationExtend`   | Stage 6 bypassed                                                          |
| `skipBarrenCheck`        | Don't stop filter early when N consecutive batches return nothing         |
| `fileSpecificCandidates` | UI behavior for candidate search                                          |

---

## 9. Agent / LLM / tools

> Most of this matches the auto-memory but with paths verified against current code.

### 9.1 Block-based communication

Every message in the system is a `Block` from a discriminated union (`lib/agent/client/blocks.ts`):

```
TextBlock | ToolCallBlock | ToolResultBlock | UserBlock | SystemBlock |
ReasoningBlock | NudgeBlock | ErrorBlock | ProgressBlock | DebugPauseBlock
```

Every block can carry `timestamp`, `source` (agent identifier for multi-agent isolation), `streaming` flag.

### 9.2 Store

`lib/agent/client/store.ts`:

- `pushBlocks(blocks, source)` — append, strip stale streaming drafts, notify listeners
- `setDraft(block)` / `getDraft()` — transient streaming
- `filterBySource(blocks, source)` — subset by agent label
- `getAllBlocks()` / `getLoading()`

`raw-store.ts` is a parallel raw-bytes store.

### 9.3 Caller

`lib/agent/client/caller.ts::buildCaller(config)`:

1. Read history (`config.readBlocks()`)
2. Convert to API messages (`convert.ts::blocksToMessages`)
3. `fetch.ts::callLlm` (with retry on 429/502/503, 30s connect / 120s stall timeouts)
4. Parse stream (`parse.ts`, `call-parse.ts`) into blocks
5. Validate tool calls against ZOD schemas → collect errors as `ToolResultBlock`
6. Execute valid calls via the executor
7. `pushBlocks(...)` all of it

There is `buildTypedCaller(name, config, schema)` for structured outputs.

### 9.4 Tool definitions and registration

`lib/agent/executors/tool.ts:1-153` defines:

- `ToolDefinition` (Claude API shape)
- `tool({name, description, schema, handler})` — the wrapper. Validates handler args against ZOD before invoking.
- `registerTool(t)` — pushes into a module-scoped map
- `toToolDefinition(schema)` — ZOD → JSON Schema → strict-mode probe (`executors/strict-schema.ts`)

**Tools are NOT auto-discovered.** `lib/agent/executors/index.ts:6-24` does side-effectful imports for every handler module; each module calls `registerTool(...)` on load. To add a tool: write the handler with `registerTool(...)` then add an `import` line.

**Block tools are generated**: `lib/agent/tools/block-tools/register.ts` walks the block registry and calls `registerTool` for each `patch_<lang>`, `add_<lang>`, `delete_<lang>`, `move_<lang>` operation (using `generate.ts`).

### 9.5 Tool catalog

| Tool                                             | Role                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `apply_local_patch`                              | The core file mutation tool — create/update/write/delete/rename/copy                              |
| `block-tools` (generated)                        | `patch_*`, `add_*`, `delete_*`, `move_*` per block language — the only way LLMs touch JSON blocks |
| `search`                                         | Hybrid search (calls `runSearchPipeline`)                                                         |
| `query`                                          | Raw SQL against DuckDB (with normalization + safety reject)                                       |
| `plan_deep_analysis`                             | Scenario-style plan generation for analysis                                                       |
| `apply_deep_analysis`                            | The numbered-sentence + matching-spans pipeline (see auto-memory)                                 |
| `refine_code`                                    | Codebook code refinement                                                                          |
| `scout`                                          | **Disabled** in `executors/index.ts:18` — but referenced by nudges and exists in `tools/scout/`   |
| `scout_filter`                                   | Filtering pass for scout                                                                          |
| `ask`                                            | Ask the user a question                                                                           |
| `submit_plan`, `start_planning`, `complete_step` | Plan workflow markers                                                                             |
| `compact`                                        | Self-triggered context compression                                                                |
| `cancel`                                         | Cooperative cancellation                                                                          |
| `run_local_shell`                                | Shell exec (registered but commented in default mode)                                             |
| `copy_file`, `rename_file`, `remove_file`        | File-level operations                                                                             |

`lib/agent/tools/file-entry.ts`, `file-view.ts`, `scout-map.ts`, `sql-describe.ts` are shared helpers used by multiple tools.

### 9.6 Agent loop

`lib/agent/agent-loop.ts`:

- `iterationConfig(tools, nudges, endpoint, processBlocks)` — per-iteration config
- Loop body (≤ `maxTurns`, default 50):
  1. `collect(...nudgers)(blocks)` — merge all nudge contributions into the prompt
  2. `excludeReasoning()` filters before nudging
  3. Caller runs → executes tool calls → pushes blocks
  4. `config.afterTurn()` hook
  5. `config.shouldContinue()` — default = `hasToolCalls(newBlocks)`

`lib/agent/runner.ts::run(deps?)`:

- Builds the executor (`createToolExecutor`)
- Wires streaming callbacks
- On AbortError, `waitForUser(signal)` then restarts

`lib/agent/dispatch.ts::dispatchTask(config)`:

- `buildTaskBlocks(config, history)` deduplicates system messages against the last 75 blocks
- Pushes them, calls `run()`

### 9.7 Nudges (steering)

`lib/agent/steering/nudge-tools.ts`:

```
interface NudgeBlock { type: "system" | "empty"; content: string; context?: () => Promise<NudgeContext> }
type Nudger = (history: Block[]) => NudgeBlock | null
```

`resolveNudge()` interpolates `{context}` with the awaited async resolver.

`steering/nudges/index.ts` registers tool-specific nudges:

- `run_local_shell` → `shellNudge`
- `scout` → `planAfterScoutNudge`
- `start_planning` → `scoutBeforePlanNudge`, `askBeforeSubmitNudge`
- `ask` → `createStepAfterAskNudge(getFiles)`

`withCooldown(n, nudger)` — only fire if at least n action blocks since last firing.

### 9.8 Derived state

`lib/agent/derived/index.ts` + `plan.ts`:

- Process the block history into a `Derived { plans: DerivedPlan[] }`
- `enrichWithResults()` ties tool calls to their result status
- `hasActivePlan()`, `lastPlan()` for decision-making
- Steps tracked via `complete_step` boundaries

### 9.9 Compaction

`lib/agent/compact.ts`:

- `stepCompactedIndices()` — marks blocks between `complete_step` markers
- `stepCompactHistory()` — filters them out while preserving structural markers
- Keeps `submit_plan`, `complete_step`, `compacted` results, system/user

### 9.10 Modes and delegation

`lib/agent/executors/modes.ts` + `delegation.ts`:

- `withModeAwareness(executor)` wraps execution to enforce mode-based tool availability
- Modes gate which tools are exposed to the LLM (e.g., "scout disabled in this mode")

### 9.11 Where chat UI state lives

There is **no `lib/chat/` folder** (auto-memory claim is stale). Chat state is folded into:

- `lib/agent/client/store.ts` (blocks + drafts)
- `lib/agent/derived/` (plans/steps)
- `ui/components/ai/` (UI rendering of chat)
- Editor-side context: `lib/editor/` (the editor knows about chat selections, etc.)

---

## 10. Editor and rendering

### 10.1 Milkdown setup

`app/ui/components/editor/MilkdownEditor.tsx:86-107` configures these plugins:

```
commonmark, gfm,
gapCursor,
createAnnotationsPlugin(),
createSpotlightPlugin(),
createSelectionPlugin(filePath),
createHiddenBlocksPlugin(),
createCalloutBlocksPlugin(nodeViewFactory),
readonly ? readOnlyPlugin : (history + clipboard)
```

Providers stacked outside the editor: `MilkdownProvider`, `ProsemirrorAdapterProvider`, `ReadOnlyProvider`, `FilePathProvider`, `DebugOptionsProvider`.

### 10.2 Block rendering decision

`lib/editor/callout-blocks/plugin.ts:8-12`:

```ts
const isRenderedBlock = (node) =>
  getBlockConfig(node.attrs.language)?.renderer === "callout" ||
  getBlockConfig(node.attrs.language)?.renderer === "chart"
```

Anything else with a known language uses `hidden-blocks/plugin.ts:19` — `display: none`, still in document. Unknown languages render as ordinary code blocks.

### 10.3 Callout node view

`lib/editor/callout-blocks/{plugin,node-view,content,view}.tsx` — a React component that:

- Reads the block's parsed JSON
- Resolves the code (callout `type: "codebook-code"`) → color/icon via codebook lookup
- Renders title + content (markdown) inside a colored container with an inline icon

The wrapper `div` carries `data-id="callout-..."` so `useScrollToEntity` can find it.

### 10.4 Chart node view

`lib/editor/chart-blocks/view.tsx:24-65`:

1. Parse chart JSON
2. `executeQuery(sql)` against DuckDB
3. For every entity ID in result rows, `resolveEntityLink(id, ...)` → `ResolvedLink`
4. Build a `ChartEntityMap` (id → label, url, color, icon)
5. Dispatch to `renderers/dispatch.ts` by chart type → BarChartRenderer / LineChartRenderer / PieChartRenderer / ...

Tooltips and labels use the `ChartEntityMap` so chart elements are themselves "pills".

### 10.5 Spotlight

`lib/editor/spotlight/types.ts`:

```ts
type Spotlight = { type: "single"; text: string } | { type: "range"; from: string; to: string }
```

A spotlight is a named text region. URL param `?spotlight=single:<text>` or `?spotlight=range:<from>:<to>` lights it up. Resolved in `lib/markdown/resolve.ts:246-261`.

### 10.6 Gutter

`lib/editor/gutter/`:

```ts
interface GutterMark {
  topPercent: number
  heightPercent: number
  colors: string[]
}
```

Visual sidebar with colored bars for annotation positions (barber-pole when multiple codes overlap a span).

### 10.7 Selection

`lib/editor/selection/` + `selection-store.ts`:

```ts
interface EditorSelection {
  text: string
  from: number
  to: number
  filePath: string | null
  context: string | null
}
```

Single global state. Read by floating toolbar, annotation hover, "clear codings on selection", etc.

### 10.8 Annotations plugin

`lib/editor/annotations/` decorates matching text ranges with colors based on the parsed `json-annotations` block. Filtering: `MilkdownEditor.tsx:34-40` removes annotations whose code is not in the currently selected codes set.

### 10.9 Hidden blocks vs. singletons

| Concept         | Where                                | Effect                        |
| --------------- | ------------------------------------ | ----------------------------- |
| Singleton       | `BlockTypeConfig.singleton: true`    | Constraint: ≤ 1 per file      |
| Hidden renderer | `BlockTypeConfig.renderer: "hidden"` | CSS `display: none` in editor |

All current singletons are hidden, but they are independent flags.

---

## 11. Entity links / pills

> **Path correction**: auto-memory pointed to `app/domain/entity-link/` and `app/lib/entity-link/`. Those don't exist. The actual implementation lives in `lib/markdown/linkify/` and `lib/markdown/resolve.ts`.

### 11.1 Parse

`lib/markdown/linkify/parse.ts::parseEntityLink(href)` → `EntityRef`:

```ts
type EntityRef =
  | { kind: "annotation"; id: string }
  | { kind: "callout"; id: string }
  | { kind: "chart"; id: string }
  | { kind: "text"; documentId: string; spotlight: Spotlight | null }
  | ...
```

Recognized hrefs:

- `file://callout-abc123`
- `file://annotation-xyz`
- `file://chart-foo`
- `file://document-id`
- `file://document-id/text-portion` (text + spotlight)

Other linkify modules: `entities.ts`, `extract.ts`, `quotes.ts`, `tags.ts` — different recognizable patterns.

### 11.2 Resolve

`lib/markdown/resolve.ts::resolveEntityLink(href, files, projectId, icons)` → `ResolvedLink`:

```ts
interface ResolvedLink {
  kind: EntityKind
  colors: { text; icon; background; backgroundHover }
  color?: string // radix color name
  icon: ComponentType // feather/lucide icon
  url: string
  label: string
}
```

- Annotation → look up by ID, find containing document, build URL with `?entity=...`
- Callout → look up code (codebook), resolve color
- Chart → resolve icon by chart type
- Text+spotlight → find all annotations containing the spotlight text → barber-pole gradient (`resolve.ts:234`)

### 11.3 Render

`ui/components/markdown/EntityLink.tsx:14-35` — styled `<a>`, icon + label, hover state.

`ui/components/markdown/createEntityLinkComponents.ts:41-74` — react-markdown integration:

- Cache: `Map<href, ResolvedLink>` invalidated on `files` change
- Falls back to plain `<a>` for `http(s):` links

### 11.4 Scroll to entity

`ui/hooks/useScrollToEntity.ts`:

- Reads `?entity=<id>` or `?spotlight=...`
- Finds element by `[data-id="..."]` or `[data-spotlight]`
- Smooth-scrolls + centers
- `MutationObserver` waits for async-rendered content (150ms settle)

---

## 12. Routes / UI shell

`app/routes.ts` is the route table (React Router 7 framework mode):

| URL                                    | File                                     | Role                                                              |
| -------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `/`                                    | `routes/home.tsx`                        | Home/launch                                                       |
| `/project/:projectId`                  | `routes/project.tsx`                     | Project shell: sidebars, DB init, embeddings init, websocket sync |
| `/project/:projectId` (index)          | `routes/project._index.tsx`              | Project overview                                                  |
| `/project/:projectId/file/:fileId`     | `routes/project.file.tsx`                | File editor + chat                                                |
| `/project/:projectId/search/:searchId` | `routes/project.search.tsx`              | Search results                                                    |
| `/designs`                             | `routes/designs.tsx`                     | Subframe design system                                            |
| `/designs/_index`, `/designs/:page`    | `designs._index.tsx`, `designs.page.tsx` | Design index/page                                                 |

`project.tsx` is where bootstrap happens: DB start, embeddings init, corpus sync, websocket connection.

UI directory map:

```
app/ui/
  components/
    editor/      — Milkdown wrapper + chrome
    markdown/    — EntityLink, react-markdown components
    ai/          — chat UI
    sidebar/     — documents, codes, exhibits, search, main
    search/      — SearchResultList
    nabu/        — branded chrome
    debug/       — devtools
    import/      — file import dialogs
  hooks/         — useScrollToEntity, etc.
  layouts/       — page layouts
  theme/         — colors, design tokens
```

---

## 13. Mutation history

`lib/mutation-history/`:

- `store.ts` — append-only in-memory `HistoryEntry[]`, subscriber pattern
- `diff.ts` — `diffFileContent(old, new, path, ts)` decomposes a change into entries
- `differs/codes.ts`, `differs/tags.ts`, `differs/annotations.ts`, `differs/prose.ts` — per-entity differs

**Only LLM mutations are recorded.** User patches bypass `pushEntries()`. The UI's undo/redo is handled by ProseMirror's `history` plugin separately.

History entries are entity-level (e.g., "code-abc added to file.md at t") — not raw patches. They're the source for any "what did the AI do?" UI.

---

## 14. Memoization and selectors

The codebase leans on **derived selectors** rather than a centralized cache. Two patterns:

### 14.1 Pure selectors over parsed blocks

Every block type has a `selectors.ts` in `domain/data-blocks/<type>/`:

- `callout/selectors.ts::getCallouts(files)`, `callout/codes/selectors.ts`
- `annotations` — `entity-ids.ts::getStoredAnnotations`
- `chart/selectors.ts::getCharts`
- `settings/selectors.ts`, `settings/tags/selectors.ts`, `settings/searches/selectors.ts`
- `attributes/{tags, date, topics, annotations}/selectors.ts`
- `ux/selectors.ts`
- `exhibits/selectors.ts`
- `corpus/selectors.ts`
- `actions/coding/selectors.ts`

These are pure `Files → DerivedData` functions. **Re-call them**; don't reparse manually. They are the canonical answer to "where is X data?".

### 14.2 Content-keyed capped caches (`lib/utils/cache.ts::createCappedCache`)

The codebase has a real memo backbone for hot paths. Pattern: content string → derived value, with a `Map`-based LRU-ish eviction at a cap. Same content = instant hit; eviction is FIFO when full. Used at:

- `lib/data-blocks/parse.ts::parseCodeBlocks` — 1000 entries
- `lib/text/find.ts::getDocTokens` — 500 entries (fuzzy tokenization)
- `lib/data-blocks/query.ts` — 3000 entries (block JSON recovery)
- `lib/search/slices.ts::getFileContext` — 500 entries (sentence split + annotation parse)
- `lib/search/source.ts::getEmbeddableSource` — 500 entries (`extractProse(file)`)
- `lib/search/source.ts::getTotalChunks` — 500 entries (companion chunk count)

Reach for `createCappedCache` when adding a new pure transform over file content that lands on a hot path.

### 14.3 Component-level memoization

- `useMemo` with `[files, ...]` dependencies in editor and markdown components
- Per-component caches like `Map<href, ResolvedLink>` invalidated when `files` changes (`createEntityLinkComponents.ts:30`)
- `domain/db/database.ts::cachedSchema` for the LLM-facing DB schema description

There is no Reselect / `createSelector`. Selectors above the capped-cache layer are pure functions that recompute on each call; the parse-layer caches mean the heavy work isn't re-done. For UX, the rule is: **call selectors freely, don't go to DuckDB**.

---

## 15. Cross-cutting patterns to remember

- **ZOD is the single source of truth.** JSON Schema, DDL, patch tools, LLM tool params — all derived.
- **Blocks (chat) and blocks (data)** are two different concepts that happen to share a name. Chat blocks: `lib/agent/client/blocks.ts`. Data blocks: `domain/data-blocks/`. Don't confuse the two.
- **Tools register at import-time** (`executors/index.ts` is the master import list). To enable scout: uncomment line 18. To add a tool: write the handler and add an import.
- **Block-tools are generated**, not hand-written. The set of `patch_<lang>` tools grows automatically when you add a block type.
- **User patches bypass mutation-history.** If you need to track a UI-initiated change, push it manually.
- **Singletons + rowPath** is the trick for "this is one block, but each array element is a row".
- **The corpus is the search input.** `domain/corpus/` extracts prose descriptions per file. Excerpts are computed via `extractProse(file)` (drops all code blocks). The HyDE generator uses these descriptions.
- **Search hits are regions of source, not chunks.** Chunks are probes; multiple probes hitting overlapping bytes collapse via `merge.ts::seedAndGrow` (rank-walk + score-ratio gate). The LLM filter and the render layer see `extractProse(file)` slices, not chunk text.
- **Sql safety lives in `lib/sql/`**, but the LLM prompt also explains what to do (`lib/agent/tools/sql-describe.ts`). Both layers matter.
- **Hidden files** (`*.hidden.md`, `*.embeddings.hidden.md`) are protected by `checkHiddenFileGuard()` in the LLM executor. Only specific tools (apply-deep-analysis result writes, embeddings sync) can write them.

---

## 16. Quick "where do I look first?" index

| If you're asking…                          | Look at…                                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| What block types exist?                    | `lib/data-blocks/registry.ts`                                                                                                            |
| How is block X validated?                  | `domain/data-blocks/<x>/schema.ts` then `lib/data-blocks/validate.ts`                                                                    |
| How does block X get into DuckDB?          | `BlockTypeConfig.projected/tableName/rowPath`, then `lib/db/ddl.ts` + `lib/db/extract.ts`                                                |
| Which tools can the LLM call?              | `lib/agent/executors/index.ts` (imports = the set)                                                                                       |
| How do I add a tool?                       | Write `handler.ts` with `registerTool`, add import to `executors/index.ts`                                                               |
| How is a chart rendered?                   | `lib/editor/chart-blocks/view.tsx` → DuckDB query → `renderers/dispatch.ts`                                                              |
| How does a pill get its color?             | `lib/markdown/resolve.ts::resolveEntityLink`                                                                                             |
| Where is the file store?                   | `lib/files/store.ts`                                                                                                                     |
| What does a `+<< file.md` mean?            | `lib/patch/resolve/range-expand.ts`                                                                                                      |
| What does `FUZZY[[...]]` mean?             | `lib/patch/resolve/fuzzy-match.ts`                                                                                                       |
| What does HyDE mean here?                  | `lib/search/resolve-semantic.ts` + `lib/corpus/generate-hydes.ts`                                                                        |
| How are search hits grouped into regions?  | `lib/search/cap.ts` (always-on per-file cap) → `lib/search/merge.ts` (`seedAndGrow` rank-walk with score-ratio gate; toggle `skipMerge`) |
| Where do search regions get their text?    | `lib/search/source.ts::getEmbeddableSource` (= `extractProse(file)`) sliced by `chunkStart`/`chunkEnd`                                   |
| Where does the LLM filter pick highlights? | `lib/search/verdict.ts` — returns sentence-index `matchRanges`; `lib/search/trim.ts` applies `trimByRanges` and split-by-SEPARATOR       |
| How do annotations extend a region?        | `lib/search/extend-annotations.ts::extendRegionsForAnnotations`                                                                          |
| Where does the agent loop live?            | `lib/agent/agent-loop.ts`, runner in `lib/agent/runner.ts`                                                                               |
| Where are nudges?                          | `lib/agent/steering/nudge-tools.ts` + `steering/nudges/`                                                                                 |
| Where is the route table?                  | `app/routes.ts`, root in `app/root.tsx`                                                                                                  |
| What gets recorded in history?             | Only LLM mutations, in `lib/mutation-history/`                                                                                           |
| Where's the LLM-visible DB schema?         | `domain/db/database.ts::getDatabaseSchema` (cached, hidden-cols filtered)                                                                |
| How does an entity get scrolled into view? | `ui/hooks/useScrollToEntity.ts` (looks for `[data-id]`)                                                                                  |

---

Praise be the pure dry functions that guide us.

Return.
