# Agent notes

Use **npm** for installs and scripts (`npm install`, `npm test`) — the e2e repo and docker stack use it too.

## Sibling repos (../)

- `nabu-storage` — Go server; stores flat markdown files per project, serves them over WebSocket. The backend this frontend talks to.
- `nabu-prompts` — system prompts for the LLM features.
- `nabu-embeddings` — Caddy proxy that adds the OpenAI key to embedding calls.
- `nabu-e2e` — Playwright tests driving the full docker stack.
- `nabu-self-hosted` — Docker Compose stack running everything together.
- `../frontend-behavior-claims.md` — every user-observable claim from this repo's README and `docs/*.md`, as checkable when/then statements backed by nabu-e2e. Changing behavior or docs means keeping this file true.

## Tests

Three layers:

- Unit: vitest, colocated `app/**/*.test.ts(x)`, node environment.
- Component: Storybook stories, run headless in chromium through the same vitest config (`npm test` runs both projects). Story conventions and shared harness live in `.storybook/` (`StoryKit`, `matrix`, decorators) — start from existing stories and mirror their format.
- E2E: `../nabu-e2e`, sparingly; keyed to the behavior-claims file.

Which layer for which work:

- New or changed UI (charts, cards, panels): stories first.
- Data flow / logic: unit tests first; stories only if rendered output changed.
- Cross-page behavior: E2E.
- Run the affected layer before calling work done.

## Layout

- `app/routes` — react-router v7 routes.
- `app/ui` — components, hooks, layouts, theme.
- `app/domain` — nabu-specific logic (corpus, documents, data blocks, embeddings, search).
- `app/lib` — generic building blocks the domain layer composes.
- `docs/` — outward-facing concept docs (numbered); `docs/specs/` holds dated working specs.

## Audience

The README and `docs/` are read by outsiders evaluating the project, not only by users. Keep their prose at that standard.
