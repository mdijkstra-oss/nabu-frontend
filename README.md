# Nabu

> Nabu is the ancient Mesopotamian (Babylonian/Assyrian) god of writing, scribes, and wisdom, often depicted with stylus and tablet; scribes worked under his patronage and commonly invoked him in their texts.

Nabu is an IRE — an Integrated Research Environment — bringing together the best of agentic IDEs in a world where prose documents are the source of truth.

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

The first part of the projection is embeddings, which let the LLM use RAG to find information across the corpus at speed.

#### Structured data

Structured data is embedded in the document as code blocks, and the renderer hides the block itself — what the user sees is a table or a graph etc. Document-wide information is stored the same way: what is annotated, tags and more. This data is projected into a DuckDB-WASM instance the LLM can query freely.

#### Full history of change

> [!WARNING]
> Partly built. Part of history of current session is neatly laid out. But backend does not have GIT implementation yet.

With files as the source of truth, another page can be taken out of programming: version control. Placing the files under version control lets the LLM query history and report change over time to the researcher, and lets other researchers see which paths were taken instead of only the final output. Time travel, reversion etc than becomes available too.

### Multimodal consensus

Nabu uses focused prompts across different tasks, and for high value tasks lets multiple models from different providers weigh in, and escalates where they disagree.

## Technical implementations

- [Data model](docs/01-data-model.md) — documents as sources of truth
- [Retrieval](docs/02-retrieval.md) — chunking, embeddings, HyDE, rank fusion, the filtering cascade
- [Agentic](docs/03-agentic/) — the [loop](docs/03-agentic/loop.md), its [tools](docs/03-agentic/tools.md) with shell like interface, and the [consensus](docs/03-agentic/consensus.md) pass
- [Sync](docs/04-sync.md) — local-first persistence and out-of-order reference resolution

### Tech stack

- **App** — React 19, React Router 7, TypeScript, Vite
- **Data** — DuckDB-WASM, MiniSearch for BM25
- **Editor** — Milkdown on ProseMirror
- **Schemas** — Zod, on both the validation and the tool-definition side
- **Tests** — Vitest with Playwright browser mode

## Related repositories

The services Nabu runs against live in their own repositories. They are being cleaned up and will be linked here.

## Known gaps

- **No authentication** — local-first and single-user for now
- **No git backend** — history covers the current session only
- **Thin test coverage**

## Running it

```bash
npm install
npm run dev
```

The app expects two services:

| Service              | Default                 | Env var         |
| -------------------- | ----------------------- | --------------- |
| Persistence and sync | `localhost:8080`        | `VITE_API_HOST` |
| Model gateway        | `http://localhost:8081` | `VITE_LLM_HOST` |

## Development

```bash
npm test          # vitest
npm run typecheck # react-router typegen && tsc
npm run lint
npm run storybook
```
