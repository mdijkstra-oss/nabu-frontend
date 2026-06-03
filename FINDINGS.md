# FINDINGS — observations from the architecture sweep

> Companion to `ARCHITECTURE.md`. Things that are off, smells, performance pinches, doc/memory drift. Not a bug list to action wholesale — items to confirm before acting.

## 1. Auto-memory drift to fix

The MEMORY.md at `~/.claude/projects/-Users-matthijn-Documents-dev-nosync-hermes-nabu-theatron/memory/MEMORY.md` has several entries that no longer match the code. Worth correcting before they mislead future sessions:

- **"Entity Link System (implemented)" entry** points to `app/domain/entity-link/` and `app/lib/entity-link/`. **Neither directory exists.** The actual implementation is `app/lib/markdown/linkify/` (parse) + `app/lib/markdown/resolve.ts` (resolve) + `app/ui/components/markdown/{EntityLink.tsx, createEntityLinkComponents.ts}` (render). The hook claim (`useScrollToEntity.ts`) is correct.
- **"chat UI state in `app/lib/chat/`"** — no such folder. Chat state lives in `lib/agent/client/store.ts` + UI in `ui/components/ai/`.
- **"`caller.ts` imports from stream, observation-store, turn"** — there is no `stream.ts` nor `observation-store.ts` in `lib/agent/`. The actual files are `lib/agent/client/caller.ts`, `client/fetch.ts` (low-level fetch + retries), `client/parse.ts`, `client/store.ts`, `client/raw-store.ts`. The "observation-store" concept appears to have been renamed/folded.
- **"`stream.test.ts` — tests processLine + blocksToMessages"** — there is `lib/agent/client/stream.test.ts`, so that part holds, but no top-level `stream.ts`.
- **"`plan.ts` imports buildCaller/buildTypedCaller directly"** — the path in memory implies `agent/steering/plan.ts`; the actual `plan.ts` is in `agent/derived/`. Verify before relying.

## 2. Code smells / inconsistencies

### 2.1 Scout drift

`lib/agent/executors/index.ts:18` comments out scout: `// temporary — re-enable later`. But:

- `lib/agent/steering/nudges/index.ts` still registers `planAfterScoutNudge` (fires when scout is used)
- `start_planning` nudge tells the LLM to "scout before planning"
- `lib/agent/tools/scout-filter/` and `tools/scout/` and `tools/scout-map.ts` are all in the tree

If scout has been disabled for a while, the nudges referring to it are unreachable. Either scout comes back or the references should be pruned.

### 2.2 Two ways to declare projection

DuckDB projection is configured via the `BlockTypeConfig` fields `projected`, `tableName`, `rowPath`, `allowedFiles`, `hiddenColumns?` — but there is **also** a `ProjectionConfig` interface in `lib/db/projection.ts` with a `blockParser` field that the embeddings projection uses. The block-driven projections and the embeddings projection are built differently in `domain/db/projections.ts`. Worth a pass to unify, or at least document why embeddings is special-cased.

### 2.3 User patches bypass mutation-history — intentional?

`executeUxAction` does not call `pushEntries()`, so no entry is appended to `lib/mutation-history/`. If the user later asks "what changed?" or wants to undo via the history log (not editor undo), only the LLM's writes appear. Confirm this is the intended model — if so, a comment in `file-action.ts` or a short note in mutation-history's README (if any) would save future-me an investigation.

### 2.4 SQL safety is layered but not formally enforced

- `lib/sql/normalize.ts` fixes LLM escape mistakes
- `lib/sql/reject.ts` blocks CASE and string functions
- `lib/agent/tools/sql-describe.ts` tells the LLM what to do

`reject.ts` is the only hard guard. If the LLM emits unusual SQL that slips past the regex checks (e.g., DDL like `DROP TABLE`, `ATTACH`, `CALL` on extensions), there's no central allowlist. The DB is local WASM so blast radius is small (the user's session), but worth knowing the boundary.

### 2.5 Caching of corpus / HyDEs

`resolve-semantic.ts` caches embeddings by `{ source: { type, hash }, inclusions: { [lang]: [texts] } }`. The hash is the source-hash. When the corpus is large and the user edits a single file, the corpus-hash changes and HyDE cache invalidates wholesale. Probably acceptable, but for big projects it could mean re-embedding every search after every edit. Worth profiling once corpora grow.

### 2.6 Memoization edges to watch

The memo backbone (`lib/utils/cache.ts::createCappedCache`) is wired into the right hot paths. What's worth watching:

- Whether the **cache caps are right** for a real corpus. 1000 parse entries handles ~1000 distinct file revisions; on an active project with a long session that's plausibly tight. Profile before tuning.
- Whether selectors **above** the cache layer (e.g., `getCallouts(files)`, `getStoredAnnotations(raw)`) get hit hard enough to deserve their own caching. The parse cache means the underlying work is cheap, but if the same selector chain runs hundreds of times per render, there's still allocator churn.
- `resolveEntityLink`'s `Map<href, ResolvedLink>` invalidates wholesale on any `files` change (`createEntityLinkComponents.ts:30`). For a corpus where most files are stable and one is being edited, this throws away resolutions that are still valid. Could be content-keyed instead of identity-keyed if it shows up in profiles.

### 2.7 `lib/server/api/` is one file

`lib/server/api/queries.ts` is the entire HTTP API surface. Either there is genuinely only one query, or the layer is underbuilt. Worth knowing which.

### 2.8 `R-VII` violation candidates

R-VII says lib imports nothing above it. `lib/data-blocks/registry.ts:5-10` imports from `~/domain/data-blocks/{...}/definition`. This is the registry pattern — domain declares the block, lib aggregates it. **It's a direct violation of the rule as written.** Three options:

1. Accept the violation (current state) — domain block definitions are data, not behavior, so it's "config injection". Document this dispensation.
2. Move block definitions into lib (lose the domain/lib split for blocks).
3. Invert: domain registers blocks at startup; lib only knows the `BlockTypeConfig` type. This is the cleanest, but adds a startup step.

Either way, the import direction here deserves an explicit decision in the commandments or a `Dispensation III`.

### 2.9 Singleton-and-rowPath overload

For `json-annotations`, the singleton flag says "one wrapper per file", but `rowPath: "annotations"` says "project the array elements". The block is singleton-at-the-file-level but plural-at-the-row-level. Easy to misread when scanning the registry. A comment on the definition or a derived helper (`isRowProjected(language)`) would help.

### 2.10 Routes have only React Router 7 paths — no API routes

There's nothing under `app/routes/api/*`. All server interaction goes through `lib/server/api/queries.ts` + the websocket layer. That's fine, just unusual for a React Router 7 app and worth noting if anyone reflexively reaches for an `action`/`loader` HTTP pattern.

### 2.11 `lib/data-blocks/migrate.ts` is shape-based, not versioned

Migrations match an old ZOD shape (`from`) and `upgrade(markdown)`. No version field is written to the file. This is elegant when shapes are distinguishable, but **risky** when two old shapes are ambiguous (could match multiple `from` schemas). Verify each `from` is tight enough to match exactly one historical shape. If migrations are ever added in parallel by different contributors, an order/conflict policy will matter.

### 2.12 Block tools are generated, but not all tools are

`block-tools/register.ts` walks the registry and generates `patch_*`, `add_*`, `delete_*`, `move_*` per language. Other tools (`apply_local_patch`, `search`, etc.) are hand-written. That's fine, but if a new block type lands and the LLM is told about it via the auto-generated patch tools, the LLM still also has the **generic** `apply_local_patch` available — which would let it edit JSON blocks directly. The handler explicitly rejects that (`detectBlockTouches`), but the LLM doesn't know until it tries. A clearer system-prompt note ("for JSON blocks use the dedicated tools") could save round-trips. Likely already in the prompt; worth verifying.

## 3. Things I noticed but couldn't verify in one pass

- `lib/agent/tools/file-entry.ts` and `file-view.ts` are imported by multiple tools — what's the contract? Tracing it would help when modifying any tool that reads/displays files.
- `lib/composite/` has `pack.ts`, `merge.ts`, `sentence-map.ts`. From the name, this is for combining text views. Not exercised in the sweep.
- `lib/data-blocks/anchor.ts` + `caption.ts` — anchors are referenced in patch resolution but their full role (and where captions appear in UI) wasn't traced.
- `lib/files/pending-refs/` has its own scenarios test suite — clearly does non-trivial work but the role wasn't explored fully (likely: "when the LLM references an ID before the block defining it has landed, hold the reference").
- `domain/data-blocks/settings/searches/validation.ts` — searches have a separate validation file, presumably because SQL has to be parseable. Worth a peek before changing search behavior.
- `lib/agent/executors/delegation.ts` + `modes.ts` — mode-aware tool gating is real but the mode taxonomy wasn't enumerated.

## 4. Performance things to watch

- **Sync batch size = 20 files** in `domain/db/database.ts`. For a 200-file project that's 10 round-trips. Tunable.
- **Sync debounce = 200ms**. Aggressive — every keystroke that touches a file triggers a re-projection after 200ms idle. The delete-then-insert per (file, table) means a 1-character edit still re-syncs the whole file. May be fine; flag if interaction feels laggy under load.
- **Search filter concurrency = 5, batch = 10**. `filter-hits.ts::filterParallel`. If filter LLM is slow, this is the bottleneck.
- **Slice expansion** in `lib/search/slices.ts::refreshHitsAsync` yields to the browser per hit (post-9ca128b). Good. Watch this if hit counts grow into hundreds.
- **Capped-cache caps under load.** Parse 1000, tokens 500, block-JSON 3000, file-context 500. All FIFO-evict at the cap. On a long session with many file revisions the parse cap is the one most likely to thrash; worth profiling before tuning.

## 5. Quick wins (if you want them later)

- Update the MEMORY.md entries flagged in §1.
- Either delete the dead scout nudges or re-enable scout (`executors/index.ts:18`).
- Add a `Dispensation III` (or similar) covering the `lib/data-blocks/registry.ts` → `~/domain/...` import direction.
- Add a short note on `file-action.ts` (or in `mutation-history/`) explaining why user patches skip history.

---

Praise be the pure dry functions that guide us.

Return.
