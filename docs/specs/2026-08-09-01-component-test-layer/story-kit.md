The story kit is what a story author imports: three decorators that fake the app's ambient dependencies, the fixture conventions, and the authoring conventions every story follows. It exists so that a story never reaches a real store, database, or router — a component's story declares which decorators it needs, and everything else about the page is inert.

## Contract

Decorators are exported from one module under `.storybook/` and applied per-story or per-meta.

| Decorator         | Parameters                                                                                                    | What it fakes                                                                                       | First consumers                                                                                                                                                                              |
| :---------------- | :------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `withSize`        | width and/or height as CSS values                                                                             | A fixed-dimension frame around the story, for components that fill their container                  | The `AxisChart` skeleton story ([charts.md](charts.md)), `CardLayoutEngine` ([search.md](search.md)), `ChatTimeline` ([chat.md](chat.md))                                                    |
| `withRouter`      | an initial path, default `/`; the kitchen sink passes a project path so `useParams` yields a real `projectId` | A memory router so `useNavigate` and `useParams` resolve at mount                                   | Every story that embeds `MilkdownEditor`, whose `AnnotationHover` calls router hooks when it mounts: the kitchen sink ([editor.md](editor.md)) and the search cards ([search.md](search.md)) |
| `withSeededFiles` | a map of file path to file content                                                                            | The module file store (`~/lib/files/store`): seeded before mount, restored to its prior state after | The `MilkdownEditor` kitchen sink ([editor.md](editor.md)), search cards embedding Milkdown ([search.md](search.md))                                                                         |

`withSeededFiles` owns the only mutable global the kit touches. Its contract is symmetrical: whatever it writes it removes, so two stories seeding different files can run in any order in one browser session without leakage. This is the kit's riskiest piece and the reason it is specced rather than left to each story.

Fixture conventions: a fixture used by more than one story file lives in a `fixtures.ts` beside those stories, exporting named plain values; a fixture one story file uses stays inline in that file. Chart fixtures come from `app/lib/chart/test-helpers.ts`, extended with the renderable builders [charts.md](charts.md) specs, rather than a new module. Chat fixtures are `KeyedSegment` values; [chat.md](chat.md) owns their shape. A fixture module contains data only — no components, no store imports.

Authoring conventions, matching the three existing story files: `title` is `Custom/<Area>/[<Group>/]<Component>` — the group segment appears where a directory level does, as in `Custom/Sidebar/Main/MainSidebar`; the default export is a `Meta` of the component; stories are args-driven `StoryObj`s, one per meaningful visual state; interactions live in `play` functions using Storybook's test utilities. A component with variant and size axes gets a matrix story; a component with a state machine gets one story per state plus a `play` walking the transitions.

The preview file (`.storybook/preview.tsx`) already loads `app/styles/index.css`, which carries the radix color variables — colored components render transparent without it, so the kit treats that import as part of its contract.

## Prior art

The three sidebar stories define the conventions the kit codifies; they stay unchanged, inline wrappers included.

`app/lib/chart/test-helpers.ts` is the existing chart test-support module (`entity`, `stubResolveRadix`, `buildColorContext`); putting the renderable builders there keeps one source of chart shapes. A separate Storybook fixture module for charts was rejected: two builders for one union drift.

`InlineMarkdown` (`app/ui/components/InlineMarkdown.tsx`) is the in-repo proof of the pattern the decorators assume: ambient values arrive as props or providers, never read from module stores inside the component.

Storybook's own `parameters`-based theming/decorator packages were not adopted; three small local decorators are the whole need, and the app has no theme switching to integrate.

## Tests

### Skeleton

The kit's skeleton piece is `withSize` wrapping the skeleton's `AxisChart` story ([charts.md](charts.md)): one decorator, one fixture from `test-helpers`, rendering green under the [harness](harness.md).

### Contract

Given two stories that each seed a different file map with `withSeededFiles`, when both run in one `storybook` project session in either order, then each story sees only its own files and the store is empty after both.

Given a story wrapped in `withSeededFiles` whose component writes to the file store during `play`, when the story finishes, then the write does not survive into the next story.

Given a story wrapped in `withRouter` whose component calls `useNavigate` and `useParams` during mount, when it renders, then it does not throw and no navigation leaves the story page.

Given a story with no decorators for a component that renders colors from radix variables, when it renders under the preview's stylesheet, then the colors resolve — the stylesheet, not a decorator, carries them.

### Isolation

Each decorator is exercised by one minimal story of a trivial element that reports what it sees (its container size, the router path, a store read). These kit-only stories live beside the decorators under `.storybook/` — a location the [harness](harness.md) glob collects — run before any area suite exists, and stay as the kit's own regression tests. Faked neighbors: none — the kit is the layer that fakes.
