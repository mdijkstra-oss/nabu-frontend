This file specs the story suites for the shared primitives at `app/ui/components/` top level, the import flow in `app/ui/components/import/`, and the markdown primitives in `app/ui/components/markdown/`. These components are (or become, via the two refactors below) props-pure, so their stories are plain args plus `play` interactions — the harness that turns them into tests is [harness.md](harness.md), and the shared decorators and conventions are [story-kit.md](story-kit.md). Editor-owned components (HighlightTooltip, FileHeader) live in [editor.md](editor.md); `app/ui/components/debug/` is excluded from the feature and gets no stories.

## Contract

Unchanged primitives keep their existing contracts: the TypeScript props in each component file are the contract, and this spec does not restate them. Three contracts change.

**ActionBar split** (`app/ui/components/FloatingActionBar.tsx`). ActionBar currently imports `NabuGate` (an agent-store subscription) to wrap actions with `variant: "ai"`, which makes it impure. The split keeps `actions: ActionBarAction[]` as data and moves the gating decision to the caller:

- `gateAction?: (button: ReactNode) => ReactNode` — new optional prop; ActionBar passes each rendered `"ai"`-variant button through it. Default is identity, so an ungated ActionBar renders every action.
- `NabuGate` import — removed from `FloatingActionBar.tsx`; the sole caller (`app/routes/project.tsx`) supplies `gateAction` wrapping the node in `NabuGate`.
- Everything else — `ActionBarAction`, the `"confirm"` variant's ConfirmButton wiring, the detail grid, `titleAction` — is unchanged.

**EntityLink hover** (`app/ui/components/markdown/EntityLink.tsx`). The hover background is currently set by `onMouseEnter`/`onMouseLeave` handlers mutating `style.background`, which real hover in a browser test cannot observe reliably and which bypasses CSS entirely:

- `onMouseEnter`/`onMouseLeave` — removed.
- Backgrounds — become CSS custom properties set in `style` (`--entity-bg`, `--entity-bg-hover`) consumed by `bg-[var(--entity-bg)] hover:bg-[var(--entity-bg-hover)]` classes, the same pattern TagBadge already uses.
- Props (`href`, `children`, `colors`, `icon`, `onClick`) — unchanged.

**FileImportView deletion** (`app/ui/components/import/FileImportView.tsx`). The component calls `useFileImport()` itself, so it cannot be rendered from args; nothing in the app mounts it — its only importer is `app/designs/subframe/pages/NabuDocuments2.tsx`, an unmounted design page. Both files are deleted. The import surface of the app is `FileDropOverlay`, which takes the entire `useFileImport` result as props and stays.

The story inventory, one file per component beside the component, titled per [story-kit.md](story-kit.md) under `Custom/Primitives`, `Custom/Import`, and `Custom/Markdown`:

| Component                     | Stories / states                                                                                                          | Play interaction                               |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------- |
| Button                        | full `variant` (10) × `size` (3) matrix in one grid story; loading; disabled; icon / iconRight                            | —                                              |
| IconButton                    | same variant × size axes; loading; disabled                                                                               | —                                              |
| LinkButton                    | `brand` / `neutral` / `inverse` × sizes; disabled; icons                                                                  | —                                              |
| Badge                         | all 5 variants; with icon and iconRight                                                                                   | —                                              |
| TagBadge                      | active, `active: false`, disabled, removable, clickable — from a `TagDefinition` fixture (`id`, `label`, `color`, `icon`) | remove click fires `onRemove`, not `onClick`   |
| Avatar                        | 5 variants × 5 sizes; initials, `image`, `square`                                                                         | —                                              |
| IconWithBackground            | 5 variants × 5 sizes                                                                                                      | —                                              |
| TextField                     | `outline` / `filled`; error; disabled; label + helpText; icon / iconRight                                                 | —                                              |
| TextFieldUnstyled             | input; textarea starting at one line                                                                                      | typing grows the textarea (see Contract tests) |
| Tabs                          | active, inactive, disabled items; with icons                                                                              | —                                              |
| Tooltip                       | static bubble                                                                                                             | —                                              |
| TooltipWrap                   | `open` forced true; each `side`                                                                                           | —                                              |
| Progress                      | 0, mid, 100                                                                                                               | —                                              |
| StatusBar                     | text only; loading spinner; with tooltip; `text: null` renders nothing                                                    | —                                              |
| CheckableWrap                 | unchecked, checked, partial, muted                                                                                        | hover reveal + toggle                          |
| ToggleGroup                   | each item selected; disabled item; with icons                                                                             | clicking an item fires `onValueChange`         |
| DismissableWrap               | wrapped content                                                                                                           | dismiss click                                  |
| ConfirmButton                 | idle; disabled                                                                                                            | two-step confirm + mouse-leave reset           |
| SwapButton                    | idle; with `activeTooltip`                                                                                                | hover swaps idle → active node                 |
| AlertDialog                   | two-entry destructive dialog                                                                                              | focus + callbacks                              |
| DropdownMenu                  | items with icons + divider, inside the Radix trigger decorator (below)                                                    | click trigger opens menu                       |
| SidebarRailWithLabels         | rail with header, NavItems, footer                                                                                        | —                                              |
| SidebarRailWithLabels.NavItem | default, selected, pointed, count badge, badge > 99                                                                       | —                                              |
| AutoScroll                    | fixed-height list the story appends to                                                                                    | append pins scroll to bottom                   |
| ScrollShadow                  | overflowing content                                                                                                       | scroll toggles top/bottom shadows              |
| AnimatedListItem              | entering item; `layout: false`                                                                                            | —                                              |
| WelcomeBackLoading            | mid-progress with status label                                                                                            | —                                              |
| BarChart                      | one categorical dataset; stacked                                                                                          | —                                              |
| InlineMarkdown                | text with entity links, files fixture as `Record<string, string>`                                                         | —                                              |
| ActionBarButton               | default, `ai`, disabled                                                                                                   | —                                              |
| ActionBar                     | actions incl. `confirm` variant; `detail` grid; `titleAction` — no `gateAction`, so all actions render                    | —                                              |
| DropZone                      | `full` / `compact` × `isDragging` true/false                                                                              | drag events reach `dragHandlers`               |
| FileImportItem                | one story per `ImportStatus` (6), enumerated from `statusConfigs`; error message; `finalPath` display                     | —                                              |
| FileImportList                | mid-processing (mixed statuses, `isProcessing`); complete (failed + unsupported counts, no Cancel)                        | —                                              |
| FileDropOverlay               | hidden (`isVisible: false`); empty + dragging (full DropZone); processing (compact + list); complete (Close button)       | —                                              |

The DropdownMenu component is only the styled panel; the app mounts it inside `SubframeCore.DropdownMenu.Root` → `Trigger asChild` → `Portal` → `Content asChild` (as `MainSidebar` does). Its story wraps the panel in exactly that Radix shell with a plain button as trigger, so the `play` can open it the way the app does.

## Prior art

The top-level primitives are Subframe-generated: their `variant` × `size` unions are the complete state space by construction, so the matrix stories enumerate the union types rather than invent states.

The three existing sidebar stories (`DocumentsSidebar`, `DocumentItem`, `MainSidebar`) set the local conventions — `Meta`/`StoryObj` from `@storybook/react-vite`, fixture data as plain consts above the meta, args-driven states — which [story-kit.md](story-kit.md) codifies; these stories follow it.

The `statusConfigs` record in `FileImportItem.tsx` is keyed `Record<ImportStatus, …>`, so it is the enumeration source for the per-status stories: a status added to the union without a story fails to compile there first.

EntityLink fixture colors come from the `ResolvedColors` tables in `app/lib/markdown/resolve.ts` (the file/spotlight/search palettes behind `resolveEntityLink`) rather than hand-picked hex, so the stories show the palettes the app actually renders.

Rejected: keeping `NabuGate` inside ActionBar and faking the agent store in a decorator — pulls store setup into every ActionBar story to test a component that is otherwise pure data-in.

Rejected: splitting ActionBar by making `actions` pre-rendered ReactNodes — loses the internal `confirm`-variant wiring and churns the one caller for no story benefit.

Rejected: keeping FileImportView as a story-only host for `useFileImport` — a component nothing mounts is dead code, not a test subject.

Rejected: testing EntityLink hover by asserting the inline-style mutation — pins the implementation detail instead of the visible hover state, and breaks the moment hover becomes CSS.

## Tests

### Skeleton

This area's slice of the walking skeleton: the Button variant × size matrix story exists and passes as a render test in the `storybook` Vitest project.

### Contract

Given an idle ConfirmButton, when it is clicked once, then the label swaps to "Confirm", the armed styling applies, and `onConfirm` has not fired.

Given an armed ConfirmButton, when it is clicked again, then `onConfirm` fires exactly once and the button enters the done state, disabled.

Given an armed ConfirmButton, when the pointer leaves it, then it resets to idle and a subsequent single click does not fire `onConfirm`.

Given an armed ConfirmButton, when its `disabled` prop flips to true, then it resets to idle rather than staying armed.

Given an open AlertDialog, when the user tabs through it, then focus reaches Cancel and then the destructive button — the dialog is a plain overlay with no focus trap, so keyboard reachability of both buttons is the pinned behavior.

Given an open AlertDialog, when the destructive button is activated, then `onDestructive` fires and `onCancel` does not, and the entries render one row per `AlertEntry`.

Given a DropZone story with spied `dragHandlers`, when dragenter, dragover, and drop are dispatched on it, then each spy is called — the props are pass-through and the story pins that they land on the outer element.

Given DropZone with `isDragging: true`, when it renders, then the highlighted background/border classes apply in both `full` and `compact` variants.

Given an unchecked, unhovered CheckableWrap, when it renders, then the checkbox is collapsed (zero width); when the row is hovered, then the checkbox appears; when the checkbox is clicked, then `onToggle` fires exactly once.

Given a partial CheckableWrap, when it renders, then it shows the dash mark, not the check.

Given a DismissableWrap inside a container with a click spy, when the X is clicked, then `onDismiss` fires and the container spy does not (propagation is stopped).

Given a one-line TextFieldUnstyled textarea, when text spanning several lines is typed, then the element height grows per line and stops growing at four lines.

Given each `ImportStatus`, when FileImportItem renders it, then the icon variant, label text, and label color match that status's `statusConfigs` row, active statuses spin, and `pending` renders half-opacity.

Given a FileImportItem with `finalPath` set, when it renders, then the path shows instead of `name`; given `error` set, then the message follows the size line.

Given a FileImportList mid-processing, when it renders, then the header reads "Processing files…", the processed/total counts match the fixture, and the progress bar width matches the ratio; given all files processed, then it reads "Import complete" and failed/unsupported counts appear.

Given a FileDropOverlay that is processing or incomplete, when it renders, then no Close button exists; given complete and not processing, then Close renders and clicking it fires `onDismiss`.

Given the CSS-ified EntityLink, when it is hovered, then its background is the fixture's `backgroundHover` value, and on unhover returns to `background` — with no JS handlers involved.

Given an AutoScroll story scrolled to the bottom, when the play appends children, then the container stays pinned to the bottom; when the user scrolls up first, then a scroll-to-bottom button appears and appending does not yank the view down.

Given the DropdownMenu story, when the play clicks the trigger, then the menu panel appears with its items and clicking an item fires that item's handler.

Given a NavItem with `badge: 120`, when it renders, then the badge reads "99+".

Given a TagBadge with both `onClick` and `onRemove`, when the X is clicked, then only `onRemove` fires.

Given a StatusBar with `text: null`, when it renders, then it renders nothing.

Given the ungated ActionBar story, when it renders with an `"ai"`-variant action and no `gateAction`, then the action renders — the identity default is the pinned behavior of the split.

### Isolation

Every component in this area is props-pure after the ActionBar split, so no fakes are needed beyond the shared decorators in [story-kit.md](story-kit.md); stories are args plus fixtures.

Import stories feed hand-built `ImportFile` and progress fixtures straight to props — no `useFileImport`, no drag-and-drop of real files, no `processFiles` call anywhere in the suite.

The FileImportView deletion is verified by absence: no file imports it (given the two deletions, when typecheck runs, then it stays green).

DropdownMenu's Radix shell and TagBadge/EntityLink color fixtures are the only story-side constructions; both reuse app modules (`@subframe/core`, `app/lib/markdown/resolve.ts`, the tag schema) rather than test doubles.
