# Search components in the component-test layer

The search area (`app/ui/components/search/`) becomes renderable from fixture data alone: `SearchBar` and `RunGroupCard` each split into a pure component plus a thin connected caller, `SearchSlicePreview` loses its context read, and `CardLayoutEngine` makes its global keydown listener opt-in — so every story mounts without the app shell, the BM25 index, or DuckDB. Stories-as-tests mechanics live in [harness.md](harness.md); decorators and story conventions live in [story-kit.md](story-kit.md).

## Contract

### SearchBarView (pure) and SearchBar (connected)

`SearchBar.tsx` splits into a pure `SearchBarView` and a connected `SearchBar` wrapper that keeps the current public shape, so `project.search.tsx` does not change.

`SearchBarView` props — each field named for its consumer inside the component:

- `query: string` and `onQueryChange: (query: string) => void` — the input becomes controlled; the wrapper owns the state so stories can pin any typeahead state as args.
- `stackHits: Bm25Hit[]` — rendered by `HitRow` under the "In this stack" header; `Bm25Hit` (from `app/lib/search/bm25/store.ts`) is `{ id, file, chunkStart, chunkEnd, score, text }`, and `HitRow` reads `id` (key), `file` (display name), `text` (snippet).
- `corpusHits: Bm25Hit[]` — rendered by `HitRow` behind the "Show N more across the corpus" reveal.
- `recentSearches`, `savedSearches`, `currentSearch?` — `SearchEntry` values rendered by `SearchRow` (`title`, `description`, `saved`, `id`) and the bar's trailing bookmark.
- `onSelectSearch`, `onToggleSave`, `onPickInStack`, `onPickCorpus`, `onRunAi` — the existing callbacks, unchanged.

Dropdown-open and corpus-reveal state stay internal to `SearchBarView`; focus and typing drive them, which is what play functions exercise.

The connected `SearchBar` is the only place the BM25 index is named: it owns the query state and computes `stackHits`/`corpusHits` via `searchBm25Live` (in-stack limited and scoped by `scopeFiles`, corpus filtered to files outside the scope), exactly as the component does today.

`HitRow` and `SearchRow` become exported so they get their own stories; their props are unchanged (`hit`/`query`/`inStack`/`onPick` and `entry`/`onSelect`/`onToggleSave`).

### RunGroupCard (pure)

`RunGroupCard` stops taking `files: FileStore` and `projectId`; the caller derives everything file-store- and URL-shaped.

Props — each field named for its consumer:

- `title: string` — passed to `FileHeader` (contract owned by [editor.md](editor.md)); the caller derives it via `toDisplayName`.
- `date` — passed to `FileHeader`; the caller derives it via `getFileDate`.
- `tags: TagDefinition[]` — passed to `FileHeader`, already resolved; the caller keeps the `getTags` + `findTagDefinitionById` lookup.
- `hits: SearchHit[]` — the detail hits rendered as `SearchSlicePreview` slices; the caller has already filtered out file-only hits.
- `hitCount: number` — the "N hits" badge in the header trailing slot.
- `debug?` — the resolved debug object forwarded to each slice (shape below); the route resolves it from its own `debugOptions`.
- `onOpenFile: () => void` — title click; the caller closes over `buildFileUrl(projectId, file)`.
- `onNavigateHit: (hit: SearchHit) => void` — the per-slice locate button; the caller closes over `buildHitUrl`.

With every prop a value or a stable callback, React's default shallow `memo` compare suffices, so the hand-written `areGroupPropsEqual` comparator is deleted.

`groupByRun`, `groupKey`, `buildFileUrl`, and the hit/spotlight helpers stay in `cards.tsx` as exported pure functions; the URL builders are only ever called by the connected caller.

### SearchSlicePreview (pure, exported)

`SearchSlicePreview` becomes exported and drops its `useDebugOptions` context read.

Props:

- `text: string` — the slice content given to `MilkdownEditor`.
- `filePath: string` — passed to `MilkdownEditor` for link resolution.
- `spotlights: Spotlight[] | null` — already converted; the matches-to-spotlights sentence splitting stays a pure helper in `cards.tsx` called by `RunGroupCard`.
- `debug?: { score?, constituentScores?, splitIndex?, splitTotal?, matchRanges?, showRawText? }` — one optional object replacing the context read; present means render the debug chrome (score line from `score`/`constituentScores`/`splitIndex`/`splitTotal`/`matchRanges`, raw-text block from `showRawText`), absent means none.
- `onNavigate?: () => void` — the hover locate button; absent hides it.

The embedded `MilkdownEditor` reaches the global file store for entity links; stories seed it with the `withSeededFiles` decorator from [story-kit.md](story-kit.md) rather than adding a render-injection seam — one existing mechanism, no new prop on the component. It also mounts `AnnotationHover`, which calls router hooks unconditionally, so every story embedding it (`SearchSlicePreview`, `RunGroupCard`) additionally wraps in `withRouter`.

### CardLayoutEngine

`CardLayoutEngine` gains `keyboardNav?: boolean`, default off; the window keydown listener (arrow-key card stepping) is only installed when it is true, and `project.search.tsx` opts in.

All other props stay as they are — `groups`, `mode`, `renderCard`, `onBandChange?`, `onNearEnd?`, `className`, and the imperative handle — since the component is already props-pure; stories supply a fixed-height container via `withSize` ([story-kit.md](story-kit.md)) because the stage measures its own height.

### Enforcement

Every pure boundary is enforced by TypeScript on the props: the pure components import no store, index, or context module, so a reintroduced global read is visible as an import, and a fixture that drifts from `Bm25Hit`, `SearchEntry`, `SearchHit`, or `TagDefinition` fails typecheck in the story file.

## Prior art

`app/lib/ui/card-layout.ts` already extracted all stack geometry as pure functions with unit tests (`card-layout.test.ts`); this spec extends the same boundary from geometry to rendering.

The sidebar stories (`app/ui/components/sidebar/documents/DocumentItem.stories.tsx` and siblings) set the local convention: args-driven `Meta`/`StoryObj`, `Custom/<Area>/<Component>` titles, an inline width decorator.

`InlineMarkdown` (`app/ui/components/InlineMarkdown.tsx`) is the in-repo template for props-not-stores: it takes `files`, `projectId`, and `navigate` as plain props where sibling components reach for globals.

Rejected: mocking `searchBm25Live` at the module level — stories would depend on test-runner mock wiring and break in plain Storybook browsing.

Rejected: passing a fixture `FileStore` into `RunGroupCard` — keeps domain selectors in the render path, keeps the hand-written comparator, and every story must encode file syntax instead of a title and tags.

Rejected: a render-injection seam for `MilkdownEditor` inside `SearchSlicePreview` — a second seeding mechanism when `withSeededFiles` already exists.

Rejected: keeping the keydown listener always-on and stubbing `window` in tests — the listener would steal arrow keys from the Storybook manager UI in every browsing session.

## Tests

### Skeleton

One `LayoutToggle` story file with two stories (`Stacked`, `Flat`) titled `Custom/Search/LayoutToggle`, where the `Flat` story's play function clicks the stacked button and asserts `onChange` was called with `stacked` — proving render, args, play, and spies run green in this area before anything is split.

### Contract

Riskiest first: given `SearchBarView` with fixture `stackHits` and a non-empty controlled `query`, when it renders in a Storybook context with no BM25 index constructed, then the dropdown shows the fixture hit rows — the pure bar never touches the module-global index.

Given `CardLayoutEngine` without `keyboardNav`, when ArrowDown is dispatched on `window`, then the visible band does not change; given `keyboardNav` on, the same key advances `onBandChange` by one.

Given `SearchBarView` typing with `stackHits: []`, when the dropdown is open, then "No matches in this stack." renders and the corpus reveal button is absent when `corpusHits` is also empty.

Given `SearchBarView` with `corpusHits` present, when the "Show N more" button is clicked in a play function, then the corpus hit rows appear with the outbound (`ArrowUpRight`) affordance.

Given idle `SearchBarView` (empty query, focus) with fixture `recentSearches` and `savedSearches`, then both sections render `SearchRow`s and a `SearchRow` bookmark click fires `onToggleSave` without firing `onSelect`.

Given the pure `RunGroupCard` with `title`, `date`, two resolved `tags`, three `hits`, and `hitCount: 3`, then the header shows "3 hits", each slice renders, and clicking the title fires `onOpenFile` — no `FileStore` in sight.

Given `SearchSlicePreview` with a `debug` object carrying `score` and `matchRanges`, then the score line and confidence labels render; given no `debug`, none of that chrome exists in the DOM.

Given `ResultRail` with `total <= 1`, then it renders nothing; given `{ current: 0, total: 5 }`, the counter reads "1 / 5" and a play click on the Next chevron fires `onStep(1)` (and Previous fires `onStep(-1)`).

Given `CardLayoutEngine` in `stacked` mode with five fixture groups, a trivial `renderCard`, and a `withSize` container, then the front card and its peeks render; switching the story to `flat` renders all cards in a scroll column.

Given `StatusCountLine`, then `loading` shows the spinner, `statusText` shows the text, and both falsy renders only the empty placeholder row.

Given `BookmarkBtn`, then `saved` renders the filled state with the "Remove from saved" label and a click fires `onToggle` exactly once.

### Isolation

All neighbors are faked at the props boundary: hits, entries, tags, and groups are inline fixtures; `MilkdownEditor` content comes from the `text` prop with `withSeededFiles` seeding only what entity links resolve against and `withRouter` satisfying its mount-time router hooks; navigation, save, and dispatch callbacks are spies.

No story constructs the BM25 store, opens DuckDB, or mounts the project shell — the connected `SearchBar` wrapper and `project.search.tsx` are exercised by the e2e suite, not here.
