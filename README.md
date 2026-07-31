# Nabu

A local-first workspace for qualitative document analysis. Documents are markdown files. Codes, annotations, settings and embeddings are JSON blocks inside those same files. An agent reads the corpus, proposes codings against a codebook, and a two-model consensus pass decides which of them survive.

Everything that looks like a database — SQL tables, vector search, a full-text index — is derived from the files and rebuilt when they change. There is no schema to migrate and no server to query.

## The idea

- **Files are the database.** A project is a map of filename to markdown, and nothing else is authoritative.
- **One declaration, many artifacts.** A block type is declared once; validation, DuckDB tables, and the agent's tools for editing it are generated from that declaration.
- **Model decisions are contested, not trusted.** Two models judge each proposed coding independently; disagreement escalates to an adjudicator that is allowed to answer "inconsistent".

## What a document looks like

````markdown
# Press conference, 12 March 2020

The prime minister opened by describing the measures as proportionate.

```json-annotations
{
  "annotations": [
    {
      "id": "ann_1",
      "text": "describing the measures as proportionate",
      "reason": "Frames restriction as calibrated rather than severe",
      "code": "3kf9m2qp"
    }
  ]
}
```
````

The prose is the document. The block is a record. Both are diffable, both are the input to the next agent turn, and the block is also a row in a SQL table.

## Documentation

- [Data model](docs/01-data-model.md) — blocks as truth, the registry, and everything derived from it
- [Retrieval](docs/02-retrieval.md) — chunking, embeddings, HyDE, rank fusion, the filtering cascade
- [Agentic](docs/03-agentic/) — the [loop](docs/03-agentic/loop.md), its [tools](docs/03-agentic/tools.md), and the [consensus](docs/03-agentic/consensus.md) pass
- [Sync](docs/04-sync.md) — local-first persistence and out-of-order reference resolution

## Model gateway

The app never names a model. It posts to named endpoints — `/hyde-generator`, `/semantic-filter`, `/deep-analysis-filter?model=0` — and a gateway resolves each name to a provider, model, reasoning effort and cache policy declared in markdown frontmatter.

That indirection is what makes the consensus pass possible: `?model=0` and `?model=1` are two different models behind one prompt, and the frontend cannot tell which. It is also what keeps provider differences out of the app entirely.

The gateway is [hermes-logos](../hermes-logos), a separate Go service.

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

> [!NOTE]
> Without the gateway the app still loads, opens documents and runs SQL — search, coding and chat are the parts that need it.

```bash
npm test          # vitest
npm run typecheck # react-router typegen && tsc
npm run lint
npm run storybook
```

## Layout

```text
app/lib/       Generic engines. Imports nothing above it.
app/domain/    Block definitions, projections, corpus, search context.
app/ui/        Components, hooks, layouts, theme.
app/routes/    React Router entry points.
```

Dependencies flow one way: `lib` knows nothing of `domain`, and `domain` knows nothing of `ui`. Where a `lib` module needs domain knowledge it takes it as a parameter — the search pipeline receives a `FileStore`, the nudges receive a `getFiles` function.

Conventions that hold throughout: `Result<T, E>` instead of thrown errors at boundaries, exhaustiveness checks on every switch over a closed set, table-driven tests with recorded fixtures rather than mocks, and no comments except where the reason for a decision cannot be read off the code.

## Stack

React 19, React Router 7, TypeScript, Vite. DuckDB-WASM with Apache Arrow for SQL. MiniSearch for BM25. Milkdown and ProseMirror for the editor. Zod for schemas, on both the validation and the tool-definition side. Vitest with Playwright browser mode.
