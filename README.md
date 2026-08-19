# Nabu

> Nabu is the ancient Mesopotamian (Babylonian/Assyrian) god of writing, scribes, and wisdom, often depicted with stylus and tablet; scribes worked under his patronage and commonly invoked him in their texts.

Nabu is an IRE — an Integrated Research Environment — applying the machinery of agentic IDEs to a world where prose documents are the source of truth.

Researchers are generally not as tech-oriented as the software engineers IDEs are built for, so, many abstractions hide the machinery underlying the system. It has to be easy to use and still have powerful capabilities, and LLMs are what make that gap bridgeable.

The first area of research targeted is qualitative coding so phrasing as of now in this document may reflect that, though in theory it extends to other domains.

https://github.com/user-attachments/assets/efde28d8-d6db-4e77-a4bc-72b3e676131c

Researchers are generally not as tech-oriented as the software engineers IDEs are built for, so, many abstractions hide the machinery underlying the system. It has to be easy to use and still have powerful capabilities, and LLMs are what make that gap bridgeable.

The first area of research targeted is [qualitative coding](https://gradcoach.com/qualitative-data-coding-101/) so phrasing as of now in this document may reflect that, though in theory it extends to other domains.

## Concepts

### Documents as sources of truth

All information lives in documents a user or an LLM can edit and manipulate. The format of choice is Markdown with JSON code blocks, edited in a block-based WYSIWYG editor hiding technicalities.

Everything queryable is either in the document, or projected from it for easier retrieval. Projections are derived, so every change happens by changing the content of a document and there are no separate database writes. This keeps queried data from going stale, and matches what models are trained to do for agentic programming: manipulate text files.

Systems are in place to ensure the information in the documents stays valid against its spec.

#### Embeddings

The first part of the projection is embeddings, which let the LLM use [RAG](docs/02-querying.md) to find information across the corpus at speed.

#### Structured data

Structured data is embedded in the document as code blocks, and the renderer hides the block itself — what the user sees is a table or a graph. Document-wide information is stored the same way: what is annotated, tags and more.

This data is projected into a [DuckDB-WASM instance](docs/02-querying.md), so anything that turns on counting is answerable directly: how often an code appears across a corpus, which documents carry none, how the balance shifted month by month. An answer can be written back into a document as a chart, which stores the query rather than the numbers and so keeps describing the corpus as it grows. Tables in the document are automatically projected into the database too as their own tables.

#### Full history of change

> [!WARNING]
> Partly built. Part of history of current session is neatly laid out. But backend does not have GIT implementation yet.

With files as the source of truth, another page can be taken out of programmings book: version control.

That lets the LLM query history and report change over time, and it lets other researchers see which paths were taken instead of only the final output. Time travel and reversion follow from the same place.

### Regions

Prose carries information that cannot be queried. A transcript knows who said each line and a diary knows what day each entry describes, but only as text, so no question can be put to it.

Regions extract it. An LLM reads each document and marks the stretches that belong to a person, a date, or whatever else a kind describes. When relevant, the LLM gets earlier found markers so it does not keep inventing new ones (eg allows attribution to same person across corpus).

| Kind     | Marks                                                                 | Queryable as                                                        |
| -------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `person` | what a document records as one person's — their words, act or account | `inferred_meta_person`, a list of identifiers                       |
| `date`   | what a document places on one point in time                           | `inferred_meta_date_start` and `inferred_meta_date_end`, timestamps |

What happened on 3 March, and what John said about the budget, are then ordinary SQL. [Documents](docs/01-documents.md#regions) has the detail.

> [!NOTE]
> **Future investigation** — finding a mention and attributing a passage to it are two different steps, and only the second needs a model's judgment. Whether a rule-based date extractor such as duckling, or a small NER model, can run in the browser is unexplored.

### Multimodal consensus

Nabu uses focused prompts across different tasks, and for high-value tasks lets multiple models from different providers weigh in.

Where they disagree, the case [escalates to a third model](docs/04-consensus.md) that sees both arguments. The disagreement is the useful part: the spans two models split on are close to the spans two human coders would argue about, so a run reports not only what it found but where the codebook itself is ambiguous.

## Technical implementations

- [Documents](docs/01-documents.md) — the file format, block declarations, regions, and what they all project into
- [Querying](docs/02-querying.md) — SQL over the tables, HyDE and rank fusion over the vectors, and the filtering cascade
- [Grounded answers](docs/03-grounded-answers.md) — identifiers resolved to names, quoted prose matched back to its passage
- [Consensus](docs/04-consensus.md) — two models judging independently, a third deciding the splits, and flags where a definition is ambiguous
- [The loop](docs/05-loop.md) — modes derived from history, per-turn context, and the guards on what a turn may do
- [Tools](docs/06-tools.md) — generated block editing, and a shell-like interface for reading
- [Sync](docs/07-sync.md) — local-first persistence and out-of-order reference resolution

### Tech stack

- **App** — React 19, React Router 7, TypeScript, Vite
- **Data** — DuckDB-WASM, MiniSearch for BM25
- **Editor** — Milkdown on ProseMirror
- **Schemas** — Zod, on both the validation and the tool-definition side
- **Tests** — Vitest for unit suites, Storybook for component work, [nabu-e2e](https://github.com/mdijkstra-oss/nabu-e2e) for browser end-to-end runs

## Related repositories

- [nabu-storage](https://github.com/mdijkstra-oss/nabu-storage) — file storage and sync, the Go service behind `VITE_API_HOST`
- [nabu-prompts](https://github.com/mdijkstra-oss/nabu-prompts) — the model gateway behind `VITE_LLM_HOST`: one Markdown file per agent, served by chancery over dragoman
- [nabu-embeddings](https://github.com/mdijkstra-oss/nabu-embeddings) — the `/embeddings` route behind `VITE_EMBEDDINGS_URL`, holding the provider key a browser cannot
- [nabu-e2e](https://github.com/mdijkstra-oss/nabu-e2e) — the end-to-end suite: every behavior claim in these docs, run against the self-hosted stack in Chromium

## Running it

> [!WARNING]
> No authentication or authorization in any way or shape - run locally against your own API keys and personal projects

```bash
npm install
npm run dev
```

The app expects three services, each of which comes up with `docker compose up` in its own directory. The gateway needs a provider key in its `.env` for each service its agents name, and the embeddings proxy needs one of its own.

### Environment variables

| Env var                      | Default                            | Points at                                                                                                                                                                                                                                                                           |
| ---------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_HOST`              | `localhost:8080`                   | [nabu-storage](https://github.com/mdijkstra-oss/nabu-storage), persistence and sync. A bare `host[:port]` — the scheme follows the page's own, so an HTTPS page reaches it over `wss://` — or a `/`-prefixed path such as `/api`, resolved against the page's own origin at runtime |
| `VITE_LLM_HOST`              | `http://localhost:8081`            | [nabu-prompts](https://github.com/mdijkstra-oss/nabu-prompts), the model gateway. A full URL, or a `/`-prefixed path such as `/llm`                                                                                                                                                 |
| `VITE_EMBEDDINGS_URL`        | `http://localhost:8082/embeddings` | [nabu-embeddings](https://github.com/mdijkstra-oss/nabu-embeddings), the embeddings endpoint itself. A full URL, or a root-relative one such as `/embeddings`                                                                                                                       |
| `VITE_EMBEDDINGS_MODEL`      | `text-embedding-3-large`           | the model every stored vector was written with                                                                                                                                                                                                                                      |
| `VITE_EMBEDDINGS_DIMENSIONS` | `1024`                             | the width every stored vector was written at                                                                                                                                                                                                                                        |

Vite reads these when it builds, so they end up compiled into the bundle rather than read from the environment the app runs in. `npm run dev` picks them up from `.env`; a built app carries whatever was set at build time, and pointing it somewhere else is a rebuild.

> [!IMPORTANT]
> Embeddings are not compatible across models or widths. A changed width is detected and re-embeds the corpus itself. A changed model is not, and the companion files have to be pruned by hand.

### Docker

The image builds the app and serves the result from Caddy. Each variable above is a build arg, and one left out falls through to its default.

With every service behind one reverse-proxy origin, the `/`-prefixed values (`/api`, `/llm`, `/embeddings`) bake a bundle that reaches its backends on whatever host the browser opened — localhost and a LAN address alike.

```bash
docker build -t nabu-frontend \
  --build-arg VITE_API_HOST=nabu.example.com \
  --build-arg VITE_LLM_HOST=https://prompts.example.com \
  --build-arg VITE_EMBEDDINGS_URL=https://embeddings.example.com/embeddings .
docker run -p 8080:8080 nabu-frontend
```

Caddy answers any path it has no file for with `index.html`, because the client resolves its own routes and a reloaded deep link would otherwise be a 404. `/health` is what the container's `HEALTHCHECK` calls.

> [!NOTE]
>
> Normally would static host this, but this makes it a bit easier for development to spin up together with the other related services.

## Development

```bash
npm test          # vitest
npm run typecheck # react-router typegen && tsc
npm run lint
npm run storybook
```

## Next: documents

Everything above rests on one idea — a project is a list of Markdown files — and [documents](docs/01-documents.md) is where it gets concrete: the format, how a block type is declared once, and what each declaration projects into. From there the path runs on through querying, the agent, and sync.
