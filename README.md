# Nabu

> Nabu is the ancient Mesopotamian (Babylonian/Assyrian) god of writing, scribes, and wisdom, often depicted with stylus and tablet; scribes worked under his patronage and commonly invoked him in their texts.

Nabu is an IRE — an Integrated Research Environment — applying the machinery of agentic IDEs to a world where prose documents are the source of truth.

> [!NOTE]
> A walkthrough video is in progress and will sit here.

Researchers are generally not as tech-oriented as the software engineers IDEs are built for, so many abstractions hide the machinery underlying the system. It has to be easy to use and still have powerful capabilities, and LLMs are what make that gap bridgeable.

The first area of research targeted is qualitative coding, though in theory it extends to other domains.

## Concepts

### Documents as sources of truth

All information lives in documents a user or an LLM can edit and manipulate. The format of choice is Markdown with JSON code blocks, edited in a block-based WYSIWYG editor hiding technicalities.

Everything queryable is either in the document, or projected from it for easier retrieval. Projections are derived, so every change happens by changing the content of a document and there are no database writes.

That keeps queried data from going stale, and matches what models are trained to do for agentic programming: manipulate text files.

Systems are in place to ensure the information in the documents stays valid against its spec.

#### Embeddings

The first part of the projection is embeddings, which let the LLM use [RAG](docs/02-querying.md) to find information across the corpus at speed.

#### Structured data

Structured data is embedded in the document as code blocks, and the renderer hides the block itself — what the user sees is a table or a graph. Document-wide information is stored the same way: what is annotated, tags and more.

This data is projected into a [DuckDB-WASM instance](docs/02-querying.md), so anything that turns on counting is answerable directly: how often a code appears across a corpus, which documents carry none, how the balance shifted month by month. An answer can be written back into a document as a chart, which stores the query rather than the numbers and so keeps describing the corpus as it grows.

#### Full history of change

> [!WARNING]
> Partly built. Part of history of current session is neatly laid out. But backend does not have GIT implementation yet.

With files as the source of truth, another page can be taken out of programming: version control.

That lets the LLM query history and report change over time, and it lets other researchers see which paths were taken instead of only the final output. Time travel and reversion follow from the same place.

### Multimodal consensus

Nabu uses focused prompts across different tasks, and for high-value tasks lets multiple models from different providers weigh in.

Where they disagree, the case [escalates to a third model](docs/04-consensus.md) that sees both arguments. The disagreement is the useful part: the spans two models split on are close to the spans two human coders would argue about, so a run reports not only what it found but where the codebook itself is ambiguous.

## Technical implementations

- [Documents](docs/01-documents.md) — the file format, block declarations, and what they project into
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
- **Tests** — Vitest for unit suites, Storybook for component work

## Related repositories

- [nabu-storage](https://github.com/mdijkstra-oss/nabu-storage) — file storage and sync, the Go service behind `VITE_API_HOST`
- [nabu-prompts](https://github.com/mdijkstra-oss/nabu-prompts) — the model gateway behind `VITE_LLM_HOST`: one Markdown file per agent, served by chancery over dragoman
- [nabu-embeddings](https://github.com/mdijkstra-oss/nabu-embeddings) — the `/embeddings` route behind `VITE_EMBEDDINGS_HOST`, holding the provider key a browser cannot

## Known gaps

- **No authentication** — local-first and single-user for now
- **Unit tests only** — Vitest suites cover the agent, block parsing, search and text handling well, and the projection and file-store layers thinly. There are no component, integration or end-to-end tests, and nothing runs automated in a browser.
- **The gateway is not reachable yet** — two fields this app sends predate the format it serves, and one of the mechanisms it relies on has nothing on the other side. See below.

### What the gateway expects

> [!WARNING]
> The app cannot yet talk to [nabu-prompts](https://github.com/mdijkstra-oss/nabu-prompts). Every agent prompt is there and every route resolves; what does not line up is on this side.

The gateway speaks [`openai-responses`](https://platform.openai.com/docs/api-reference/responses). What this app receives already matches — `app/lib/agent/client/parse.ts` reads that event stream, and the items `convert.ts` builds are Responses input items. The body it sends carries `input` and `text.format`, and the two cache breakpoints on the consensus steps are `prompt_cache_breakpoint` markers on content parts. One thing is still not the format's:

| what is sent              | what the format spells it              | where                                                    |
| ------------------------- | -------------------------------------- | -------------------------------------------------------- |
| `?model=0` and `?model=1` | the route suffixes `.fast` and `.deep` | `app/lib/agent/tools/apply-deep-analysis/step-filter.ts` |

It does not fail, which is what makes it the one to fix. The consensus step selects its two voters by that query parameter; the gateway routes on the path and ignores it, so both calls reach the same model and a two-model consensus becomes one model voting twice with nothing in the log to say so.

Reasoning and function calls go back as the objects they arrived as. `parse.ts` keeps each output item whole on the block it builds and `convert.ts` returns that object rather than rebuilding one, so provider state this app has no name for survives the turn boundary along with the fields it does know. Assistant text is still assembled from its deltas, which carry nothing beyond the text.

One mechanism has no equivalent on the other side at all. `app/lib/agent/executors/modes.ts` pushes `<!-- prompt: planning -->` as a system message for the server to expand, and the gateway never decodes the message array, so the marker reaches the model as literal text. The mode prompts are in nabu-prompts, reachable by no route.

None of this touches [querying](docs/02-querying.md), which reaches [its own service](#embeddings) rather than the gateway.

## Running it

```bash
npm install
npm run dev
```

The app expects three services:

| Service              | Default                 | Env var                | Repository                                                          |
| -------------------- | ----------------------- | ---------------------- | ------------------------------------------------------------------- |
| Persistence and sync | `localhost:8080`        | `VITE_API_HOST`        | [nabu-storage](https://github.com/mdijkstra-oss/nabu-storage)       |
| Model gateway        | `http://localhost:8081` | `VITE_LLM_HOST`        | [nabu-prompts](https://github.com/mdijkstra-oss/nabu-prompts)       |
| Embeddings           | `http://localhost:8082` | `VITE_EMBEDDINGS_HOST` | [nabu-embeddings](https://github.com/mdijkstra-oss/nabu-embeddings) |

All three come up with `docker compose up` in their own directory. The gateway needs a provider key in its `.env` for each service its agents name, and the embeddings proxy needs one of its own.

### Embeddings

Two variables besides the host describe what the corpus is made of:

| Env var                      | Default                  |
| ---------------------------- | ------------------------ |
| `VITE_EMBEDDINGS_MODEL`      | `text-embedding-3-large` |
| `VITE_EMBEDDINGS_DIMENSIONS` | `1024`                   |

Both travel in the request body, because the proxy forwards what it is given and adds only the key. Neither is a preference: every vector in a `.embeddings.hidden.md` companion was written at that model and that width, and a vector of one width scored against another returns a number rather than an error.

Changing either is therefore a re-embedding of the whole corpus.

A new width performs that itself. `diffChunks` treats a chunk whose stored vector is the wrong length as one it has never seen, and the sweep runs at startup where every file counts as changed, so the cost is one pass and no manual deletion.

> [!IMPORTANT]
> A new model at the same width is not detected. Nothing records which model wrote an entry, so `text-embedding-3-small` at 1024 would be mixed into vectors from `text-embedding-3-large` at 1024 and scored against them. Delete every `.embeddings.hidden.md` companion by hand when changing the model alone.

## Development

```bash
npm test          # vitest
npm run typecheck # react-router typegen && tsc
npm run lint
npm run storybook
```

## Next: documents

Everything above rests on one idea — a project is a list of Markdown files — and [documents](docs/01-documents.md) is where it gets concrete: the format, how a block type is declared once, and what each declaration projects into. From there the path runs on through querying, the agent, and sync.
