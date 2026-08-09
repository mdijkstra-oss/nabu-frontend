# Editor

Stories-as-tests for the editor area: `app/ui/components/editor/**` plus the callout block views in `app/lib/editor/callout-blocks/`, running under the harness in [harness.md](harness.md). Most components become storyable through three small splits and three exports; the one component that must not be split, `MilkdownEditor`, gets a single seeded kitchen-sink story that doubles as the integration smoke test. Chart block views are owned by [charts.md](charts.md).

## Contract

### EditorToolbar

Already pure; no change. Consumer: the selection overlay below.

- `groups: ToolbarItem[][]` — each `ToolbarItem` is `{ icon, onClick?, active?, disabled? }`; groups render with dividers between them
- `className?`

### FileHeader

FileHeader's contract lives here; its consumers are `DocumentBubble` and the search result cards ([search.md](search.md)).

- `title: string` — rendered in one of three modes, by precedence: `onRename` present → editable title; else `onTitleClick` present → link-styled button; else static span
- `date?: string` — formatted through `formatShortDate`
- `tags?: TagDefinition[]` — one dot per tag; a dot is a remove button only when `onRemoveTag` is present
- `onRemoveTag?(tagId)`, `onAddTag?()` — add button renders only when `onAddTag` is present
- `menuItems?: { icon, label, onClick }[]` — non-empty list renders the `…` dropdown
- `onRename?(title)`, `renameRequested?`, `onRenameSettled?()` — the external-trigger path into edit mode (used by the title-edit request store in `DocumentBubble`)
- `trailing?: ReactNode`, `className?`

Export the private `TagDot` (`{ tag: TagDefinition, onRemove? }`) and `EditableTitle` (`{ title, onRename, renameRequested?, onRenameSettled? }`) from `FileHeader.tsx` so each gets its own story.

Enforcement is the existing TypeScript prop types; no runtime validation is added anywhere in this spec.

### SelectionToolbarOverlay — split from FloatingToolbar

New pure component in `FloatingToolbar.tsx`: the positioned toolbar-plus-pill that today renders inline inside the wrapper.

- `selection: { top, centerX, hasRange, showAbove }` — the existing `SelectionState` shape; `top`/`centerX` position the overlay, `showAbove` flips the translate, `hasRange` gates the pill
- `codes: readonly Code[]` — passed through to the pill
- `onCodeClick(codeId: string)`

The static all-disabled formatting groups stay internal to the overlay; they are a constant, not a caller decision.

The wrapper `FloatingToolbar` keeps every side effect, named here as its boundary: DOM `selectionchange`/`mousedown` listeners with rAF scheduling, hover-hide timers, the file store read (`useFiles` → `getResolvedSelectedCodes`), `useIsReadOnly`, and the write path (`resolveEditorSelection` → `buildAnnotationPatchOps` → `executeUxAction`).

### AnnotationPill — exported from FloatingToolbar.tsx

- `codes: readonly Code[]` — empty list disables the trigger and sets its explanatory `title`; non-empty enables hover popup listing one `CodeEntry` per code
- `onCodeClick(codeId: string)`

Its only DOM dependency is `window.innerHeight` for popup flip, which works unmodified in browser-mode tests.

### GutterMarks — split from ScrollGutter

New pure component in `ScrollGutter.tsx`: the click-to-scroll track that renders positioned mark elements.

- `marks: GutterMark[]` — the existing type from `app/lib/editor/gutter/types.ts` (`topPercent`, `heightPercent`, `colors`); first color wins as mark background
- `onScrollTo(percent: number)` — computed from click Y within the track's own rect, which is event geometry the pure component may own

The wrapper `ScrollGutter` keeps the content/scroll-container refs, the `MutationObserver`, and the `measureAnnotationSpans` → `calculateGutterMarks` pipeline.

### DocumentStack — pure inner

New pure inner `DocumentStackView` in `DocumentStack.tsx`:

- `underlyingCount: number` — shells rendered is `min(2, underlyingCount)`
- `front: ReactNode`, `onUnderlyingClick()`, `className?`

The wrapper `DocumentStack` keeps its `files: Record<string, string>` + `activeId` props and derives `underlyingCount` via `getSelectedDocs`; existing callers are untouched.

### CalloutBlockView — readOnly becomes a prop

- `data: CalloutBlock`
- `onDelete()`
- `readOnly?: boolean` — plain default `false`, not read from context

Feasibility verified: the only caller, `CalloutNodeView` in `node-view.tsx`, already calls `useIsReadOnly` for its own `BlockSpacer` gating and passes the value down, so `view.tsx` drops its `ReadOnlyContext` import entirely. `readOnly` hides the hover delete button.

### CalloutContent

Already pure; no change. `data: CalloutBlock` — `type` selects the icon from `calloutTypeIcons` (one key: `codebook-code`), `color` tints icon and is used by the parent's edge bar, `collapsed` collapses to title-only, expanded mounts `MarkdownContent` for `content`.

### MarkdownContent

Already props-only; no change. `content: string`, `className?`. It mounts a real Milkdown instance (commonmark + gfm), which makes its story the cheapest proof that Milkdown runs in the Storybook browser.

### HighlightTooltip

Already takes plain data; no change. `entries: HighlightEntry[]` (id, color, optional title/description/review/reviewCount/isLocked, all callbacks optional — absent callbacks render the read-only variants), `onEntryHover?`, `onEntryLeave?`.

Export the private adapter `annotationToEntry` from `AnnotationHover.tsx` as the fixture factory: called with `filePath` undefined it produces entries whose mutation callbacks are all absent, so fixtures never touch the store. `onCopy` is not a mutation and stays present — a read-only entry still offers its clipboard-only copy button. `AnnotationHover` itself is infra (portal, hover state machine, editor dispatches) and gets no story.

### MilkdownEditor

Settled: no split — it is the integration point and stays one component. Props unchanged: `content`, `debugMode?`, `debugOptions?`, `readOnly?`, `spotlight?`, `filePath?`, `onChange?`.

Side effects at this boundary, exercised only by the kitchen-sink story: file store reads (`useFiles` for annotations and selected codes), `normalizeAsStored` canonicalization before `onChange`, and the annotation writes reachable through the embedded `FloatingToolbar`.

## Prior art

`MarkdownContent` already proves a Milkdown editor mounts from props alone — the whole plan leans on that.

`gutter/types.ts` and the pure modules under `lib/editor/annotations` set the precedent this spec follows: measurement and store I/O in wrappers, plain data types at the seam.

The sidebar stories (`DocumentItem.stories.tsx` et al.) set the conventions reused here — `Custom/…` titles, args-only stories, a fixed-width wrapper decorator; shared decorators come from [story-kit.md](story-kit.md).

Splitting `MilkdownEditor` into provider stack + core — rejected; it IS the integration point, and a split would only produce a core that cannot run without the same providers.

Splitting `DocumentBubble` into chrome + editor — rejected for now; its chrome is `FileHeader` + `StatusBar` (covered separately) and its risk is the Milkdown mount, covered by the kitchen-sink story.

Keeping `CalloutBlockView` on `ReadOnlyContext` and wrapping stories in `ReadOnlyProvider` — rejected; a prop is smaller than a decorator, and the caller already holds the value.

Passing toolbar groups into `SelectionToolbarOverlay` as a prop — rejected; the groups are a static all-disabled constant with no caller variance.

## Tests

### Skeleton

This area's piece of the skeleton is the `MarkdownContent` story rendering green in the browser project: one story, representative markdown, an assertion that rendered ProseMirror content appears. It proves Milkdown-in-Storybook is cheap before anything else is built, and `CalloutContent` (which embeds `MarkdownContent`) plus the kitchen sink ride on it.

### Contract

Riskiest first.

**Kitchen sink (MilkdownEditor).** Given a file store seeded via `withSeededFiles` and a `content` markdown document containing prose, a callout block, and a chart block ([charts.md](charts.md) owns the chart's rendering contract), when the story mounts, then the prose renders as editable ProseMirror content, the callout renders as `CalloutBlockView`, and the chart renders as its block view. When the play function types into the editor, then `onChange` fires with canonical markdown containing the typed text. This is the single most valuable browser test in the suite: it exercises the provider stack, the node-view factory, the plugins, and the store-fed annotation path in one mount.

**EditableTitle keyboard flows.** Given the button mode, when clicked, then an autofocused input appears with the title selected. When the user types a new title and presses Enter, then `onRename` fires once with the trimmed value and the input closes. When the user types and presses Escape, then `onRename` never fires and the button returns showing the original title. When the committed value is empty or unchanged, then `onRename` does not fire. Given `renameRequested`, when the story mounts, then the input is already open and closing calls `onRenameSettled`.

**CalloutBlockView readOnly gating.** Given `readOnly` false, when the block is hovered, then the delete button appears and clicking it calls `onDelete`. Given `readOnly` true, then no delete button exists in the DOM.

**FileHeader variant matrix.** Stories cover: the three title modes (static, `onTitleClick`, `onRename`); tags absent vs present, with and without `onRemoveTag`; date absent vs present; `menuItems` empty vs populated (menu opens and item `onClick` fires); `trailing` content. One play assertion per interactive variant: remove-tag click reports the tag id, add-tag click fires, title-link click fires.

**AnnotationPill.** Given empty `codes`, then the codebook trigger is disabled and carries the instructional `title`. Given codes, when the trigger is hovered, then the popup lists each code by name; when a code row is clicked, then `onCodeClick` fires with that code's id.

**SelectionToolbarOverlay.** Given a `selection` with `hasRange` false, then only the formatting toolbar renders; with `hasRange` true, the pill renders beside it. `showAbove` true/false stories pin both placements for visual review.

**GutterMarks.** Given fixture marks at known percents, then each mark renders at its `topPercent`/`heightPercent` with its first color. When the track is clicked partway down, then `onScrollTo` receives the matching percent.

**CalloutContent matrix.** Stories cover the `codebook-code` type (the sole `calloutTypeIcons` key) × collapsed true/false × a representative color sample from `BLOCK_COLORS` (edge cases: first, last, and one mid-palette — not all 31). Expanded shows title plus rendered markdown content; collapsed shows title only.

**HighlightTooltip.** Given entries built by `annotationToEntry` with `filePath` undefined, then read-only variants render (no lock/delete/edit affordances). Given a hand-built entry with stub callbacks, then lock, copy, delete, resolve, and both textareas render, and delete/lock clicks reach their callbacks; `isLocked` disables editing with the unlock tooltip. Multi-entry stories pin the gradient header and hover isolation callbacks.

**DocumentStackView counts.** Given `underlyingCount` 0, then no shells render behind `front`; 1 renders one shell; 2 and 3+ both render exactly two (the peek cap). Clicking a shell fires `onUnderlyingClick`.

### Isolation

Zero stores, zero decorators beyond layout: `EditorToolbar`, `FileHeader`, `TagDot`, `EditableTitle`, `AnnotationPill`, `SelectionToolbarOverlay`, `GutterMarks`, `DocumentStackView`, `MarkdownContent`, `CalloutContent`, `CalloutBlockView`, `HighlightTooltip` — every story in this file except the kitchen sink runs on props alone.

`withSeededFiles` is needed only by the MilkdownEditor kitchen sink, whose embedded `FloatingToolbar` and `AnnotationHover` read the file store; it also needs `withRouter` from [story-kit.md](story-kit.md) because `AnnotationHover` calls router hooks.

Not storied: the `FloatingToolbar`, `ScrollGutter`, and `DocumentStack` wrappers (side-effect shells over storied pure parts), `AnnotationHover` (infra; its visual payload is `HighlightTooltip`), and `DocumentBubble` (composition node; covered through the kitchen sink and its storied parts).
