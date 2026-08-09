The harness turns every Storybook story into a Vitest browser-mode test. It is the wiring layer: a Vitest workspace with two projects, the `@storybook/addon-vitest` plugin, and the npm scripts that run them. It contains no stories and no components; [story-kit.md](story-kit.md) owns what story authors use, the area files own the stories themselves.

## Contract

`npm test` runs two Vitest projects and fails if either fails.

| Project     | Environment                                                      | What it runs                                                                 |
| :---------- | :--------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| `unit`      | Node                                                             | Every existing `*.test.ts` under `app/`, unchanged in behavior and selection |
| `storybook` | Chromium via the `@vitest/browser-playwright` provider, headless | Every story matched by the Storybook config                                  |

The story-to-test rule: a story that renders without throwing passes; a story that throws fails, and the failure names the story. A story with a `play` function additionally runs it, and an assertion failure inside `play` fails the test the same way.

The Storybook config (`.storybook/main.ts`) is the single source of which stories exist. Its glob covers `app/ui/**/*.stories.tsx`, `app/lib/editor/**/*.stories.tsx`, and `.storybook/*.stories.tsx` — the last for the [story-kit](story-kit.md) regression stories and this file's trivial isolation story. The `storybook` Vitest project reads the same config through the addon plugin, so the viewer and the test runner can never disagree about the story set.

Configuration lives in `vitest.config.ts` at the repo root, plus the addon registration in `.storybook/main.ts` and a setup file the addon requires under `.storybook/`. The addon package `@storybook/addon-vitest` is a new dev dependency; `@vitest/browser-playwright` and `playwright` are already installed.

Scoped runs use Vitest's project filter: `npx vitest --project unit` and `npx vitest --project storybook`. The `test:watch` script keeps its current meaning (watch mode over both projects).

Side effects at this boundary: the `storybook` project launches a headless Chromium that Playwright manages. Nothing in the harness reaches the network; a story whose page requests an external resource (the preview's font stylesheet) must still pass when that request fails.

One-time machine setup: `npx playwright install chromium` downloads the browser binary. A run without it fails with Playwright's install instruction, which is the intended error surface.

## Prior art

`@storybook/addon-vitest` is Storybook's supported integration for exactly this: it registers stories as Vitest tests and runs `play` functions as interactions ([Storybook docs](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon)). The installed Storybook 10 and Vitest 4 fall inside its peer range.

`@storybook/test-runner` was rejected: it drives a running Storybook server with Playwright directly, adds a second test framework beside Vitest, and duplicates what the addon does inside the toolchain already present.

Plain Vitest browser tests without stories were rejected: each test would rebuild the mount and fixture work a story already is, and the visual review surface would be lost.

The repo has no `vitest.config.ts`; the `unit` project's file selection must reproduce what `vitest run` currently picks up by default, so the existing suites keep running identically.

## Tests

### Skeleton

The harness carries the spine of the walking skeleton: after wiring, `npm test` runs the existing unit suites plus the three existing sidebar stories (`MainSidebar`, `DocumentsSidebar`, `DocumentItem`) as render tests, all green, with no story files changed.

### Contract

Given a story that throws during render, when `npm test` runs, then the run fails and the failure output contains that story's title.

Given a story whose `play` function makes a failing assertion, when the `storybook` project runs, then that story fails while sibling stories still report individually.

Given the existing unit suites, when `npm test` runs after wiring, then every test that passed before the harness existed passes, and none is skipped or newly excluded.

Given a story file under `app/lib/editor/`, when the `storybook` project runs, then the story is collected — the glob extension is load-bearing, not cosmetic.

Given the Chromium binary is absent, when the `storybook` project starts, then the run fails with Playwright's install instruction rather than hanging.

Given the machine is offline, when a story renders a page that requests the preview's external font stylesheet, then the story still passes.

### Isolation

The harness is exercised alone with a single trivial story under `.storybook/`: one args-only story of a plain element, no decorators, no fixtures. If that story passes as a test and the unit project still passes, the harness works regardless of the state of every area suite. No area file's components are needed.
