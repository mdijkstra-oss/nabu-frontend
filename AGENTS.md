# Agent notes

Use **npm** for installs and scripts (`npm install`, `npm test`) — the e2e repo and docker stack use it too.

## Sibling repos (../)

- `nabu-storage` — Go server; stores flat markdown files per project, serves them over WebSocket. The backend this frontend talks to.
- `nabu-prompts` — system prompts for the LLM features.
- `nabu-embeddings` — Caddy proxy that adds the OpenAI key to embedding calls.
- `nabu-e2e` — Playwright tests driving the full docker stack.
- `nabu-self-hosted` — Docker Compose stack running everything together.

## Tests

Three layers:

- Unit: vitest, colocated `app/**/*.test.ts(x)`, node environment.
- Component: Storybook stories, run headless in chromium through the same vitest config (`npm test` runs both projects). Story conventions and shared harness live in `.storybook/` (`StoryKit`, `matrix`, decorators) — start from existing stories and mirror their format.
- E2E: `../nabu-e2e`, Playwright against the full docker stack.

Which layer for which work:

- New or changed UI (charts, cards, panels): stories first.
- Data flow / logic: unit tests first; stories only if rendered output changed.
- Run the affected layer before calling work done.

### Which layer a test belongs at

Start at the bottom and only move up when the layer below genuinely cannot answer the question. A test at too high a layer costs runtime and diagnosis time and proves nothing extra.

- **Unit** — a pure function, or one module with its neighbours faked. Grammars, transforms, schemas, lifecycles against a fake at the module's own boundary. Most tests are these.
- **Component** — rendered output and interaction: what the user sees and what a gesture produces. A story is the artifact; the `play` function is the assertion.
- **E2E** — the whole system as a person uses it.

A test earns the e2e tier only by answering **yes to all three**:

1. Does it cross a boundary that cannot be faked without changing what is under test? The real DuckDB-wasm engine, the real Go storage server over its websocket, a real browser. Faking one tests the fake.
2. Is it a journey someone actually performs, rather than a variation on one? A different fixture down the same path is a variation — make it another assertion in the journey that already exists, not another test.
3. Could it fail for a reason no in-process test could produce?

Any "no" means it belongs lower. The bar is this high because e2e tests are slow, flaky and expensive to diagnose, so each one has to earn its runtime. A behavior worth documenting is not automatically a behavior worth an e2e test — it is usually worth a unit test.

## Layout

- `app/routes` — react-router v7 routes.
- `app/ui` — components, hooks, layouts, theme.
- `app/domain` — nabu-specific logic (corpus, documents, data blocks, embeddings, search).
- `app/lib` — generic building blocks the domain layer composes.
- `docs/` — outward-facing concept docs (numbered); `docs/specs/` holds dated working specs.

## Audience

The README and `docs/` are read by outsiders evaluating the project, not only by users. Keep their prose at that standard.
