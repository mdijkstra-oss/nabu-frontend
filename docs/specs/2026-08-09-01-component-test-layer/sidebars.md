# Sidebars

The sidebar area (`app/ui/components/sidebar/**`) gets full story coverage under the stories-as-tests harness ([harness.md](harness.md)), which requires two components to shed their store coupling first: `DocumentsSidebar` and `CodesSidebar` each split into a pure component (selection in, callbacks out) and a thin connected wrapper that keeps the `~/lib/files/store` read/write. Everything else in the area is already pure and only needs stories, written to the conventions in [story-kit.md](story-kit.md).

## Contract

### DocumentsSidebar (pure) — `documents/DocumentsSidebar.tsx`

New props, added to the existing prop set; all optional so the existing story file compiles unchanged.

- `selectedDocIds?: ReadonlySet<string>` (default empty set) — read by `SelectableDocument` for `isChecked` and by the tag rows for `selectionState` (checked/partial). `getSelectedDocs` derives a `Set<string>`, which satisfies `ReadonlySet`; `selectionState`'s first parameter widens from `Set` to `ReadonlySet` since it only reads.
- `onToggleDoc?: (id: string) => void` — fired by `SelectableDocument`'s checkbox toggle, in both the flat filtered list and the hover fly-out.
- `onToggleTag?: (ids: string[]) => void` — fired by a tag row's `CheckableWrap` with that group's document ids; the caller decides add-all vs remove-all.

The `useSyncExternalStore` read of `~/lib/files/store`, `getSelectedDocs`, and the `writeSelectedDocs` calls (with `toggleSelectedDoc` / `addIds` / `removeIds` / `selectionState`) move out of this file entirely.

### ConnectedDocumentsSidebar — `documents/ConnectedDocumentsSidebar.tsx` (new)

Renders the pure component; owns the store boundary and nothing else: reads `~/lib/files/store` via `useSyncExternalStore` + `getSelectedDocs`, writes via `writeSelectedDocs`. Same props as the pure component minus the three selection props it fills in. Consumer: `app/routes/project.tsx` switches its import to this.

### CodesSidebar (pure) — `codes/CodesSidebar.tsx`

- `selectedCodeIds?: ReadonlySet<string>` (default empty set) — read by each code row's `CheckableWrap` for `checked` and by the auto-scroll effect (`computeBestWindowScrollTop` already takes `ReadonlySet<string>`).
- `onToggleCode?: (id: string) => void` — fired by `CheckableWrap` toggle and by `CodeItem` body click.
- `searchValue?: string` / `onSearchChange?: (value: string) => void` — lifted from local state to props, feeding `SidebarHeader`; matches the `DocumentsSidebar` / `ExhibitsSidebar` API so all three sidebars filter the same way.

The auto-scroll `useLayoutEffect` stays in the pure component: it reads only the `selectedCodeIds` prop and the component's own DOM ref, so the wrapper stays render-only and no ref prop is needed.

The store read and `writeSelectedCodes` / `toggleSelectedCode` calls move out of this file entirely.

### ConnectedCodesSidebar — `codes/ConnectedCodesSidebar.tsx` (new)

Same shape as `ConnectedDocumentsSidebar`: reads `~/lib/files/store` + `getSelectedCodes`, writes via `writeSelectedCodes`, owns the `searchValue` state it lifts back in. Consumer: `app/routes/project.tsx`.

### Exports

- `SelectableDocument` becomes a named export of `documents/DocumentsSidebar.tsx` — consumer: its own story file. Props unchanged: `doc`, `color`, `isCurrent`, `isChecked`, `onToggle`, `onSelect`.
- `SearchCodeButton` becomes a named export of `codes/CodesSidebar.tsx` — consumer: its own story file. Props unchanged: `code`, `globalCount`, `onClick`.

### Unchanged boundaries

`SidebarHeader`, `SelectionBar`, `DocumentItem`, `CodeItem`, `CodeDetail`, `ExhibitsSidebar`, `ExhibitItem`, and `MainSidebar` keep their prop types as-is; stories consume them directly.

Enforcement: TypeScript prop types.

## Prior art

- [`main/MainSidebar.stories.tsx`](../../../app/ui/components/sidebar/main/MainSidebar.stories.tsx), [`documents/DocumentsSidebar.stories.tsx`](../../../app/ui/components/sidebar/documents/DocumentsSidebar.stories.tsx), [`documents/DocumentItem.stories.tsx`](../../../app/ui/components/sidebar/documents/DocumentItem.stories.tsx) — the convention reference: `Custom/Sidebar/<Group>/<Component>` titles, args-driven stories, sizing decorators.
- [`exhibits/ExhibitsSidebar.tsx`](../../../app/ui/components/sidebar/exhibits/ExhibitsSidebar.tsx) — the already-pure sibling proving the target shape: data and `searchValue` in, callbacks out, hover fly-out as local UI state.
- `InlineMarkdown` (`app/ui/components/InlineMarkdown.tsx`) — the props-not-stores pattern this split follows.
- Rejected: keeping the store reads and testing through a seeded file store — couples every story to store internals and hides the selection UI whenever the store is empty, which is exactly the existing gap.
- Rejected: required selection props — breaks the three existing green stories for no coverage gain over defaults.
- Rejected: exposing hover fly-out state as a prop — it is transient UI state, and play-function hover exercises the real code path.
- Rejected: auto-scroll behind a ref prop in the wrapper — splits one behavior across two files when the effect is already props-driven.

## Tests

All tests are Storybook play functions running under Vitest browser mode ([harness.md](harness.md)); decorators and conventions per [story-kit.md](story-kit.md).

### Skeleton

The three existing story files — `MainSidebar` (3 stories), `DocumentsSidebar` (3), `DocumentItem` (3) — run green as browser tests with zero changes; that is this area's piece of the walking skeleton.

They stay green through the split because the new selection props default to an empty set and no-op callbacks — the same rendering the empty store produces today.

### Contract

Riskiest first.

- Selection set rendering — given the sample documents and `selectedDocIds` containing one doc of a two-doc tag group, when `DocumentsSidebar` renders, then that group's row shows the partial state and a fully-covered group shows checked.
- Toggle fires — given a rendered `DocumentsSidebar` with a filter active (flat list), when the play function clicks a document's checkbox, then `onToggleDoc` is called with that document's id and no store is touched.
- Tag toggle fires — given grouped view, when the play function toggles a tag row, then `onToggleTag` receives exactly that group's document ids.
- Empty documents — given `documents: []`, when `DocumentsSidebar` renders, then the header and sort controls render and the list is empty without error.
- Filter with no matches — given `searchValue` matching nothing, when `DocumentsSidebar` renders, then the flat list renders zero rows.
- Filter input filters — given `SidebarHeader` (and the sidebars via args), when the play function types into the filter, then `onFilterChange` / `onSearchChange` fires per keystroke and the clear button appears; clicking it fires with the empty string.
- Codes selection — given a codebook and `selectedCodeIds`, when `CodesSidebar` renders, then the matching `CheckableWrap`s are checked and clicking a `CodeItem` fires `onToggleCode` with its id.
- Codes auto-scroll — given a codebook taller than the viewport with the selection near the bottom, when `CodesSidebar` mounts, then the list is scrolled so selected rows are in view (real layout, browser mode).
- Codes fly-out — hover state is local `useState` (`hoveredCode`), not a prop, so the story's play function hovers a `CodeItem`; then the detail panel appears with `CodeDetail` and `SearchCodeButton`.
- `CodeItem` count click isolation — given a code with a count, when the play function clicks the count badge, then `onCountClick` fires and `onClick` does not (stopPropagation pin).
- `CodeItem` permutation matrix — one story per visual state: default, highlighted, with count, compact review badge warning, compact review badge danger, `debugReview` ratio badge (normal/warning/danger), long name truncation.
- `SearchCodeButton` — zero count renders disabled; nonzero renders the count and fires `onClick`.
- `CodeDetail` — markdown detail with headings and lists renders through the custom component map.
- `ExhibitsSidebar` — grouped state (kind rows with count badges) and searching state (flat filtered list); exhibit selection fires `onExhibitSelect`; fly-out via play-function hover like codes.
- `ExhibitItem` — per subtype color/icon, selected state, long titles clamped.
- `SidebarHeader` — with and without `onNew`; empty vs filled filter value.
- `SelectionBar` — active (bar visible), checked-but-not-active (renders nothing), inactive (hover-revealed); the story decorator supplies the `group`-classed hoverable parent the component assumes.
- Extended `DocumentsSidebar` stories — checked and partial group states, checked docs in the filtered flat list, fly-out doc list with checked docs via play-function hover.

### Isolation

No story mounts a connected wrapper: `~/lib/files/store`, `writeSelectedDocs`, and `writeSelectedCodes` are never imported by anything a story renders.

No pointing store setup: `usePointedAt` degrades to `false` outside the app, which is the exact rendering `MainSidebar` stories assert.

What the wrappers do fake-free is deliberately untested here — the read/derive/write plumbing is a handful of lines exercised by the end-to-end suite in the separate `nabu-e2e` repository.
