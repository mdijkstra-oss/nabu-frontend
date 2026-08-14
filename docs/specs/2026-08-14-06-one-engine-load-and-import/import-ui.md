# Import UI

The file-drop overlay and its queue rows. Today a row's life ends at "written to store"; now the store write happens through [ingest](ingest.md) and the row keeps advancing as the [engine](engine.md) reports its stages, ending at "Added" only when every stage has settled. The import side never runs fixer work — it writes files and listens.

## Contract

### Consumes

- [Engine events](engine.md#events) — the per-file, per-stage stream, keyed by store path. The import UI is one of its two projections (the [boot view](boot-view.md) is the sibling; neither depends on the other).
- [Ingest](ingest.md) — the store write. The import caller resolves the final path itself (normalize + dedupe stay in `app/lib/import/process.ts`, caller-side) and passes it to ingest; ingest owns migrate/normalize/validate/write.

### Exposes

The extended `ImportStatus` union (`app/lib/import/types.ts`). Every status exists because a row renders it distinctly:

| Status        | Rendered as                                                                                                                                                                              | New?                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `pending`     | dimmed row, "Queued" — before reading, and again after ingest until the engine picks the file up                                                                                         | reused                      |
| `reading`     | highlighted, spinner, "Reading..."                                                                                                                                                       | as-is                       |
| `processing`  | highlighted, spinner, "Processing..." — inside ingest (migrate/normalize/validate/write)                                                                                                 | as-is                       |
| `embedding`   | highlighted, spinner, "Understanding..."                                                                                                                                                 | new                         |
| `classifying` | highlighted, spinner, "Classifying..."                                                                                                                                                   | new                         |
| `regions`     | highlighted, spinner, "Finding regions..."                                                                                                                                               | new                         |
| `completed`   | green check, "Added" — every engine stage settled, including stages that had nothing to do                                                                                               | meaning shifts              |
| `incomplete`  | warning icon, "Imported, processing incomplete" — a fixer stage failed; the file **is** in the project and the engine retries on its next pass. The row must not read as a failed import | new                         |
| `unsupported` | warning icon, "Not supported" — never reaches ingest                                                                                                                                     | as-is                       |
| `error`       | red, "Could not import" — failed before the store: unreadable, non-markdown structure, rejected by ingest validation                                                                     | label changes from "Failed" |

The stage identifiers (`embed`, `classify`, `regions`) are contract, defined in [engine.md#events](engine.md#events); this table is the normative source for import row wording — a label quoted anywhere else defers to it. Boot row labels live in [boot-view.md](boot-view.md).

The `ImportFile` row shape — the fields `FileImportItem` renders:

- `id` — the original dropped filename; the row key from drop to dismissal.
- `name` — original filename, shown until `finalPath` exists.
- `finalPath` — the store path ingest wrote to (may differ from `name` after dedupe); replaces `name` in the row once set.
- `size` — bytes, formatted.
- `status` — one value of the union above.
- `error` — message appended to the size line for `error` and `incomplete` rows.

The progress counter — the `progress` object `useFileImport` exposes, extended:

- `total` — dropped files.
- `completed` — rows at "Added" only.
- `incomplete` — rows in the warning state (new field).
- `failed`, `unsupported` — as today.
- `processed` — rows in any terminal state (`completed` + `incomplete` + `failed` + `unsupported`). A file mid-engine counts toward nothing; the header reads "N of M files processed" and dismissal unlocks only when `processed === total`.

### Post-terminal rows

Rows in `completed`, `error`, or `unsupported` are frozen: they ignore all further engine events, so a user editing an already-Added file while the overlay is open never regresses the row or the counter. `incomplete` is the one exception — it may move forward to `completed` when a later pass settles its failed stage (the engine retries; see [engine.md](engine.md)), never any other direction. Progress then recomputes `incomplete`-- / `completed`++, but the row already counted toward `processed`, so dismissal never re-locks.

### The finalPath → row join

Rows are keyed by original filename, but dedupe may store the file under a different path, and engine events carry only the store path. `processFiles` already returns `finalPath` through its status callback (`onStatus(id, status, { finalPath })`); the hook records it on the row **and** in a synchronously-written map (a ref, not only React state) before ingest returns — so an engine event emitted in the same tick as the store write still finds its row. Each incoming engine event looks up its path in that map; a hit advances the mapped row, a miss is ignored (the event belongs to a boot file or an edit, not this drop). The subscription lives while the overlay has files and ends on dismissal.

### Side effects and enforcement

Side effects at the boundary: `FileReader` reads of dropped `File` objects, and store writes via ingest. Nothing else — no fixer calls, no pool, no store subscriptions beyond the engine's event stream.

Dropped `File` objects are hostile. The import side rejects what it can see without trusting content: read errors become `error`; non-`.md` names become `unsupported` and never reach ingest; and filenames that are hidden or companion files (`isHiddenFile` in `app/lib/files/filename.ts`, e.g. `x.embeddings.hidden.md`, `notes.hidden.md`) are rejected caller-side before ingest and shown "Not supported", same as non-markdown — the engine filters hidden paths from its diff, so an ingested one would never receive an engine event and its row would sit at "Queued" forever. The hidden check runs on the post-`normalizeFilename` name, before dedupe: `isHiddenFile` matches the lowercase `.hidden.` marker case-sensitively while `normalizeFilename` lowercases, so checking the raw name would let `Notes.Hidden.md` through — and a dedupe suffix splits the `.hidden.` marker apart, so checking after dedupe would let a colliding hidden name through the same hole. After dedupe, the final path is additionally rejected unless the engine will actually process it (`isEmbeddableFile`, which also excludes the exact names `preferences.md` and the settings file): the rule is that a path written by import must be an engine candidate, never a name whose row waits forever on events that cannot come. Content validation (corrupt structure) is ingest's job and is not repeated here — the import side merely renders ingest's rejection as `error`.

## Prior art

This extends the existing import feature; nothing is built new.

- `app/ui/hooks/useFileImport.ts` — gains the engine-event subscription, the finalPath map, and the extended progress derivation; `isProcessing` derives from "any row non-terminal" instead of the `processFiles` promise settling. Drag handling, visibility, and dismissal stay.
- `app/lib/import/process.ts` — `processMarkdownFile` calls ingest with the deduped path instead of `updateFileRaw`, and gains an error path for ingest rejection. Sequential loop, read, dedupe stay.
- `app/lib/import/types.ts` — union and `ImportFile`/progress shapes extend as above.
- `app/ui/components/import/FileImportItem.tsx` — new rows in `statusConfigs`, the `error` label change, `isActive` covers the three stage statuses, new `StatusIcon` cases. Layout untouched.
- `app/ui/components/import/FileImportList.tsx` — renders `incomplete` in the summary line; bar and layout stay.
- `FileDropOverlay.tsx`, `DropZone.tsx`, `folder.ts`, `read.ts`, `dedupe.ts` — unchanged.
- `app/ui/components/import/fixtures.ts` — fixture builder covers the new statuses.

A separate new import panel loses because every affordance it would need — queue rows, status table, dimmed/highlighted treatment, progress bar, overlay lifecycle — already exists and is story-pinned; a second panel would duplicate all of it and then have to be reconciled with this one.

## Tests

### Skeleton

The import slice of [spec.md](spec.md)'s walking skeleton: drop one small `.md` file on a booted project; its row appears, runs Reading → Processing through ingest, then Understanding → Classifying → Finding regions → Added as the engine reports. One file, real stack, before any breadth.

### Contract

Riskiest first:

- **Given** a file in the store whose classify stage the engine reports failed, **when** the event arrives, **then** the row shows the warning "Imported, processing incomplete" — not red — and the file remains in the project.
- **Given** a dropped file ingest rejects as structurally corrupt, **when** ingest returns, **then** the row is red "Could not import" and the store has no entry for it.
- **Given** a dropped file whose name collides so dedupe stores it under a suffixed path, **when** engine events arrive under that final path, **then** they advance the row keyed by the original filename, and the row displays the final path.
- **Given** a file every one of whose stages settles with nothing to do (already embedded, hash match, regions scanned), **when** the engine settles it, **then** the row still reaches "Added" — the transition to settled is an explicit event, never silence.
- **Given** a dropped `.png`, **when** the drop is processed, **then** ingest is never called and the row shows "Not supported".
- **Given** a dropped file named like a companion or hidden file — a forged `x.embeddings.hidden.md`, or the mixed-case `Notes.Hidden.md` that is hidden only after normalization — **when** the drop is processed, **then** ingest is never called, the store never contains it, and the row shows "Not supported".
- **Given** two dropped files, one at "Added" and one still classifying, **then** `processed` is 1 of 2 — mid-engine files count toward nothing and dismissal stays locked.
- **Given** a row at "Added" and the user editing that file while the overlay is open, **when** the engine re-runs the file's stages and emits fresh events for its path, **then** the row and the progress counters are untouched — terminal rows are frozen.
- **Given** a row at "Imported, processing incomplete", **when** a later pass settles the stage that had failed, **then** the row moves to "Added" — `incomplete`-- / `completed`++ — and `processed` is unchanged, so dismissal never re-locks.

### Isolation

Per `AGENTS.md`: stories first for changed UI, unit tests for the hook logic.

- Storybook (`.storybook/` conventions; extend `FileImportItem.stories.tsx` and its `assertMatchesStatusConfig` pattern): one story per new status driven through `statusConfigs` and `fixtures.ts` — `embedding`, `classifying`, `regions` (highlighted, spinning), `incomplete` (warning, error line rendered), the relabeled `error` — plus a `FileImportList` story of a mixed queue with the engine faked as a static list of already-applied events, showing queued-dimmed rows alongside active and terminal ones.
- Unit (vitest, colocated): the hook's engine-event/row-state logic lives in a pure module (`fileImportRows`: rows, the finalPath→row map, and stage outcomes as one immutable value; the hook is a thin wire holding it in a synchronously-written ref) and is tested there against the [engine event contract](engine.md#events) — the join cases above (dedupe rename routing, unknown-path events ignored, settled-without-work reaching "Added", warning vs red, frozen terminal rows ignoring later events, `incomplete` advancing to `completed` without changing `processed`), and the progress derivation counting only terminal rows. The unit project runs in node with no React testing harness, so the hook itself is not rendered under test; the extraction is what makes the logic testable.
