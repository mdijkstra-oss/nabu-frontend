# Boot view

The project loading screen. Today `app/routes/project.tsx` walks the boot phases in sequence and `WelcomeBackLoading` (`app/ui/components/WelcomeBackLoading.tsx`) shows one status label at a time with a weighted overall progress bar. Under the engine the three fixer stages interleave per file, so a single sequential label for them is no longer truthful. This view replaces those three sequential phases with three concurrent stage rows — each a files-settled-of-total counter advancing simultaneously — while every non-engine phase keeps its current sequential treatment.

## Contract

Consumes:

- **Engine events** — the per-file, per-stage stream defined in [engine.md#events](engine.md#events), folded by stage into `{settled, total}`. The fold is a small pure module — an event list in, per-stage counters out — and the loading screen renders from its output:
  - `total` — files seen for that stage; grows as files first appear in the stream, so a file a later pass adds grows it.
  - `settled` — files whose stage reported settled (work done or nothing to do) or failed. A failed file counts as settled for gating: boot must never hang on a failed file.
  - Row labels, stated here and nowhere else — the sequential phase wording carried over: "Understanding your content…" (embed), "Classifying documents…" (classify), "Finding regions…" (regions).
- **Engine ready promise** — resolution of the engine's first pass, one of the dismissal gates.
- **Non-engine phase signals, unchanged from today's `project.tsx`:** the file-loading count (`fileCount` / `totalFiles`, driven by the SyncMeta command's `fileCount` and per-file received commands), the database sync progress callback (`OnDbSyncProgress` from `startDatabase`), BM25 (`startBm25`, awaited without a counter, as today), and the finalizing step (`syncOnce` then `startBackgroundSync`).

Exposes: nothing. This is a leaf view — no other component reads from it.

Side effects: none beyond rendering. Stage failures surface as: boot proceeds, the error goes to the console, and no blocking UI appears — the failed file lands in the warning state the import queue defines, not in the boot screen.

Dismissal: the loading overlay disappears when the existing gates plus the engine's ready promise have all resolved — files loaded, required files present, database synced, engine first pass settled, BM25 built, final sync done. Same gating structure as today, with the engine promise standing in for the three awaited reconcilers. The engine starts only after initial file load and database sync complete ([engine.md](engine.md)), so its first pass runs over the fully loaded store and `ready` gates something real.

Enforcement: engine events are trusted internal shapes ([engine.md#events](engine.md#events)); the view validates nothing.

## Prior art

Extended, not replaced:

- `app/ui/components/WelcomeBackLoading.tsx` — gains the three concurrent stage rows below (or in place of) the single caption. The overall weighted progress bar stays; the three fixer weights are now fed from the aggregated stage counters instead of the phase callbacks.
- `app/routes/project.tsx` — the boot effect keeps its shape. What changes: the three sequential `await startEmbeddings/startTopicAssignment/startRegions` calls and their three `useState` pairs (`embeddingProcessed/Total`, `topicProcessed/Total`, `regionProcessed/Total`) are replaced by an engine event subscription feeding the pure fold module, whose per-stage `{settled, total}` output the loading screen renders; the three `setStatusLabel` calls for those phases go away. What stays: file count tracking, `statusLabel` for the sequential phases ("Connecting…", "Loading files…", "Syncing database…", "Finalizing…"), db sync progress, and the dismissal gating order.
- `app/ui/components/WelcomeBackLoading.stories.tsx` — the existing story is the template for the new fixture stories.

A rebuilt loading screen loses because the current one already owns the layout, theming, and the progress-bar math the non-engine phases still need — a rebuild would re-derive all of it only to change three rows.

## Tests

**Skeleton.** The boot slice of [spec.md](spec.md)'s walking skeleton: boot the demo project against the dev stack; the loading screen shows the three stage rows filling concurrently (counters advancing interleaved, not one row completing before the next starts), then dismisses when the first pass settles. This is the slice that proves the event aggregation and the dismissal gate against the real engine.

**Contract.** Riskiest first:

- **Given** a file whose embed stage fails, **when** the engine's first pass otherwise settles, **then** the failed file counts as settled in its row, the loading screen dismisses normally, and the failure appears only in the console — no hang, no blocking UI.
- **Given** a fully processed project ([spec.md](spec.md)'s pinned no-op boot), **when** the app boots, **then** all three rows reach settled == total near-instantly from work-free settled events alone and the screen dismisses without stage work.
- **Given** files whose stages settle with nothing to do, **when** their settled events arrive, **then** they advance the counters exactly like worked files — a boot over mostly-clean files shows full rows, not stuck ones.
- **Given** a file ingested during boot (a mid-boot import), **when** the engine's first pass is running, **then** the file is not picked up mid-pass — candidates are fixed at pass start — and its events arrive only from the following pass. If those events arrive while the screen is still up (other gates pending), totals grow to include the file and rows never regress. Dismissal gates on the engine's ready promise plus the existing non-engine gates, and once dismissed the screen never returns.

**Isolation.** Two seams:

- The fold is unit-tested as a pure module against [engine.md#events](engine.md#events) with fixture event lists: a mixed stream folding to per-stage `{settled, total}`, a `failed` event counting toward settled, and a file first appearing in a later pass growing the total without shrinking any counter.
- Storybook stories for the loading screen rendered from the fold's output shape — plain `{settled, total}` props per stage, no engine running: empty (all zeros, first-pass counting not yet reported), mid-flight interleaved (all three rows partially filled to different degrees), complete (all rows settled == total), and one-stage-failed (a row whose settled count includes a failure, showing that the row renders as progress, not as an error state). Stories follow the existing `WelcomeBackLoading.stories.tsx` and `.storybook/` conventions; per `AGENTS.md`, stories come first for this UI change.
