# Ingest

The single function through which a file enters the store: run data-block migrations, then write through the store, which normalizes and validates structurally. Two callers: the WebSocket sync path (`app/lib/server/sync/apply.ts`) and the import path (`app/lib/import/process.ts`). Ingest does not call the [engine](engine.md); they meet only at the store, where the engine picks up dirty files downstream.

## Contract

Ingest is synchronous per file, as both call sites are today. It takes a final path and content — filename work (`normalizeFilename`, deduplication against existing names) stays caller-side in the [import UI](import-ui.md); the sync path passes the server's path verbatim.

In:

- `path` — where the file lands in the store. Sync: the command's path, untouched. Import: the already-normalized, already-deduplicated name.
- `content` — raw markdown as received. Sync: the `WriteFile` command's content. Import: the `FileReader` text.

Out, a discriminated result:

- Success. The file is in the store under `path` in stored-normal form. Carries one field, `migrated`: whether migrations rewrote the content on the way in. Consumed by the sync path to persist the rewritten form back to the server; the import path ignores it, because the store's own persist already sends whatever was stored.
- Rejection. The structural validation errors (the payload of `FileCorruptionError`, `app/lib/files/errors.ts`). The file never landed in the store. Consumed by the import UI for the row's "Could not import" state and by the sync path's console report.

Side effects at the boundary:

- The store write (`updateFileRaw`), which normalizes and structurally validates as it does for every write.
- The store's deferred server persist that the write triggers — unless the caller suppressed it. Persist suppression is the caller's concern: the sync path wraps ingest in `withoutPersist` and calls `schedulePersist(path)` when the result says `migrated`, exactly the dance `apply.ts` performs; the import path suppresses nothing, so every imported file persists.

Enforcement: raw content is hostile until parsed. Migrations match blocks against their old-shape zod schemas (each migration's `from`, defined with the migration under `app/domain/data-blocks/migrations/`); the store's `validateStructural` (`app/lib/data-blocks/validate.ts`) throws `FileCorruptionError` on a corrupt markdown file, which ingest converts into the rejection result. No schema is restated here — they live where linked.

Stated once: the migration list lives in `app/domain/data-blocks/migrations/index.ts` and ingest imports it from there. No second list, anywhere.

## Prior art

`applyCommandInner`'s `WriteFile` arm in `app/lib/server/sync/apply.ts` already **is** this function: `migrateFile(content, migrations)`, then `updateFileRaw`, then report whether migration changed the content. Ingest is extracted from it, not rebuilt beside it. `processMarkdownFile` in `app/lib/import/process.ts` is the second caller to rewire — today it calls `updateFileRaw` directly and skips migrations, which is the bug this spec fixes.

A new parallel implementation loses for the same reason the bug exists: two write paths drift, and the drifted one silently admits unmigrated files.

## Tests

### Skeleton

Ingest carries the entry half of the [walking skeleton](spec.md#walking-skeleton): the boot files stream in through sync and the one dropped `.md` file lands through import, both through the same function. The slice proves it when the dropped file appears in the store migrated and normalized before the engine's stages start reporting on it.

### Contract

Riskiest first:

- **Given** a file whose block matches an old migration schema, **when** it arrives via import, **then** the stored content is the migrated form, and the server receives that migrated form — one write, never the pre-migration bytes.
- **Given** a structurally corrupt file, **when** it arrives via import, **then** ingest returns the rejection with the validation errors, the store does not contain the file, and the import row shows the error.
- **Given** the same corrupt file, **when** it arrives via WebSocket sync — today `updateFileRaw` throws `FileCorruptionError` and `apply.ts` does not catch, so the exception escapes `applyCommand` into the socket message handler — **then** under this spec: ingest returns the rejection, the sync caller logs it (the store already reports the corruption to the console), the file never lands, no persist-back is scheduled, and subsequent commands in the stream still apply. Same stored outcome as today; the change is that one bad file no longer breaks the command loop.
- **Given** an already-migrated file already in stored-normal form, **when** it arrives via either path, **then** it passes through byte-identical, the result says not migrated, and sync schedules no persist-back.
- **Given** initial sync running under `withoutPersist`, **when** ingest writes an unchanged file, **then** no server write occurs — only `schedulePersist` for migration-rewritten files reaches the server, pinned today by the `app/lib/server/sync` tests and kept true.

### Isolation

Run ingest alone against a store faked per its contract: a write that normalizes and throws `FileCorruptionError` on corrupt content, nothing more. Feed it the real migration list from `app/domain/data-blocks/migrations/index.ts`. Assert the order — migration before the write, so the store only ever sees migrated content — the `migrated` flag on rewritten input, and the throw-to-rejection mapping.
