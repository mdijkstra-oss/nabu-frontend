# agents

The registry is the only part of the tool that knows what a route means. Everything else — the runner, the recorder, the report — works the same whichever agent is named. An adapter's whole job is to turn a path and some flags into a call to the app's own entry point, and to hand back whatever that entry point constructed.

## Contract

A **DebugAgent** declares:

- `name` — the word on the command line.
- `summary` — one line, printed in the help listing.
- `input` — `file` or `directory`, saying what the positional path must be.
- `extras` — a schema over the flags this agent takes beyond the base ones. It is the only definition of those flags: the help text is generated from it, and `run` receives its output rather than raw argv.
- `constructedLabel` — what the constructed artifact is called in the report, so a reader knows whether they are looking at hits, a block, or a set of exclusions.
- `run(input)` — returns the constructed artifact, JSON-serializable, or rejects. It returns `undefined` where nothing was constructed. It rejects with `UsageError` — before making any call — for input the schema alone could not check, such as a `--hits` file that does not exist or does not parse; the runner turns that into exit `2`.

Each field of `extras` carries `.meta({ placeholder, description })`, which is what the runner's generated help prints. `defineAgent(agent)` is how an adapter is registered: it lets `run` receive `extras` in the schema's own output type and hands the registry the erased shape.

**RunInput**, the shape every adapter receives:

- `files` — a `FileStore`, the app's own `Record<path, content>`. One entry for a `file` agent, one per markdown file for a `directory` agent. Using the app's type means `verdict` and `seedVocabulary` take it directly rather than through a translation nobody would maintain.

Keys are basenames, never the path as typed. A file's name reaches the model: `buildEntryMessages` renders it as the `file` attribute of every entry. In the app that attribute is a project-relative name like `interview-01.md`, so keying by an absolute path would put a machine-specific string into the prompt under test and make the request differ from production on a line the model reads.

- `extras` — the parsed flags, already the shape the schema describes.

Flags arriving from `mri` are `Record<string, unknown>` and are hostile until parsed. The runner parses them against the agent's `extras` schema before `run` is entered, so an adapter never checks whether a required flag is present, never coerces a string to a number, and never sees a shape that could be invalid. A schema failure is a usage error, handled in [runner.md](runner.md).

**An adapter calls the app and does not reimplement it.** It may derive the input the app's entry point expects — splitting sentences, cutting units, building a `FindWork` — using the same functions the app uses. It may not build messages, batch, retry, or interpret a reply. Where the app exposes a whole pass, the adapter drives the pass rather than its pieces.

**An adapter never writes.** Where the app's entry point takes a write callback, the adapter supplies one that captures and returns instead. This is the only reason the tool can run an agent whose real code path ends in a file mutation.

**No adapter injects a `ParseCall`.** Calls are captured at `fetch`, described in [recorder.md](recorder.md), so every entry point runs with its own defaults and the tool exercises exactly the dispatch the app performs.

## The agents

`--kind` is a shared flag whose schema resolves the id to its `KindDescriptor` and rejects an unknown id with the registered list, so no adapter looks a kind up itself.

**region-finder**, file. Extras: `--kind <id>` required, `--known <comma-separated>` optional. Cuts the file's prose into scan units with `proseOf`, `indexProseSentences` and `cutUnits`, builds one `FindWork` per unit — the unit, and the slice of sentences it spans — and calls `runFind` with a job carrying the kind from `regionKinds()` and a known-value set from `--known`. Constructed: the hits collected from `onAnswered`, each with kind, quote, document-wide `hitSentence`, and value.

`--known` exists because the app seeds this set from every region already stored across the project and then grows it between calls within a run. On one file it starts empty and the model is told to infer values from the text alone, which is a materially different prompt from the one production sends. The flag is how that state gets reproduced deliberately rather than by accident.

**region-marker**, file. Extras: `--kind <id>` required, `--hits <path>` required. Parses the hits file — the constructed output of `region-finder`, unchanged, either the bare JSON or a whole saved report (the hits are read from below the last `== hits` heading, so a `--constructed-only > hits.txt` redirect works as it is) — rejects with a usage error before any call when a hit's `kind` is not the `--kind`, computes windows with `computeWindows` against the whole document's sentences, builds one `MarkWork` per windowed hit, and calls `runMark`. Constructed: the marks, each a hit plus its start and end sentence.

The hits arrive through a file rather than from a previous step because nothing here writes: a finder run goes to stdout, and the operator redirects it. That is the same round trip the two agents' shapes are designed for — a `Hit` survives JSON exactly.

**region-pass**, file. Extras: `--kind <id>` optional, defaulting to every registered kind. Drives `planRegionFilePass` with a `getFile` reading the one file, the real `runFind` and `runMark`, and a `writeRegions` that captures. Its `knownValuesFor` is `seedVocabulary` over the one-file store — the same function the app calls, over one file instead of a project. Constructed: the `RegionsBlock` that would have been written.

There is deliberately no `--known` here. This is the agent that answers what the app would really do, and hand-feeding it a vocabulary the app would not have had makes it answer something else. `region-finder` is where the vocabulary is experimented with, and it takes the flag. The distinction also avoids a flag that would have to apply per kind: `runFind` reads known values only for kinds whose value type needs a shared vocabulary, so one list across every kind in a pass would mean nothing for half of them.

This agent exists because the other two answer a different question. `region-finder` and `region-marker` isolate one call so a prompt edit can be judged against one reply; `region-pass` runs find, mark, reconcile and merge together and produces the artifact the app would actually store. A prompt can be right in the first and wrong in the third.

The two differ in one way that will surprise a reader who does not expect it. `region-finder` ignores any `json-regions` block in the file and finds over every unit, so it always calls. `region-pass` reconciles first, so a file whose units are already scanned under the current rules hash has nothing left to ask and makes zero calls — the same precondition case as `topic-assigner` below. Debugging a prompt against a file that already carries its own answers is the easiest way to spend ten minutes on a tool that is working correctly.

**scout-filter**, file. Extras: `--framework <path>` required. Chunks the file with `chunkFileForEmbedding`, turns the chunks into entries with `buildChunkBlocks` and `assignIds`, and calls `filterEntries` with the framework file's contents. Constructed: the excluded entry ids paired with the chunk offsets they name.

**semantic-filter**, file. Extras: `--intent <text>` required. Builds one `SearchHit` per scan unit — `file` and `text` are the only fields the filter reads — and calls `verdict` with an empty framework. The empty framework is deliberate: `scoutFilterBatch` returns its batch untouched when the framework is empty, so the run isolates the semantic filter instead of testing two routes at once. The answer cache is already off, from [host.md](host.md). Constructed: the hits with the spans the filter kept, each with its confidence and its reason.

**topic-assigner**, file. Extras: `--types <comma-separated>` and `--subjects <comma-separated>`, both optional. Drives `planClassifyFilePass` with the real `classifyDocument` and a capturing write, so the excerpt is built the way the app builds it. Constructed: the classification.

The pass declines to run when `shouldReclassify` says the file already carries a current classification, and the report will show a run with zero calls. That is correct behavior rather than a failure, and the report distinguishes them.

**file-hyde**, file. Extras: `--language <name>` required. Calls `generateFileHydes` with the whole file. Constructed: the generated passages.

**corpus-describer**, directory. Extras: `--language <name>` and `--corpus <name>`, both required. Takes the prose of each markdown file in the directory as samples and calls `describeGroup`. Constructed: the description.

`describeGroup` skips the model entirely and joins the samples when they total fewer than 500 words, so a small directory produces a run with zero calls. Same as `topic-assigner`: reported, not treated as an error.

## Not supported

**deep-analysis-filter** and **deep-analysis-adjudicate** take envelopes — a file, character offsets, halo sentences, a marked span, a code id — which the app produces from an embeddings search over DuckDB. Constructing them from a file means inventing a span-selection rule the app does not have, and a run against invented spans says nothing about the route as it is used.

**refine-code** reads a code definition together with the annotations flagged against it across every file in a project. Its input is a project, not a file or a directory of prose.

**hyde-generator** and **generic-hyde** take a query and a corpus description. Neither is derived from a document, so nothing about them is file-driven.

**qual-coder** is a multi-turn agent loop with tools, streaming and file mutations, not a call.

## Prior art

`scripts/debug-chunking.ts` is the pattern being followed: the script parses flags with `mri` and holds no logic, while the work lives in `app/lib/debug/chunking-report.ts` where it is unit-tested without running the script. This registry belongs under `app/lib/debug/try-prompt/agents/` for the same reason, one file per adapter and the registry in its index; the runner, recorder, report and host sit beside it in `app/lib/debug/try-prompt/`.

Every adapter's target already exists and is exported: `runFind` and `runMark` in `app/lib/regions/detect/`, `planRegionFilePass` in `app/lib/regions/sync.ts`, `filterEntries` and `buildChunkBlocks` in `app/lib/agent/tools/scout-filter/api.ts` and `app/lib/search/scout.ts`, `verdict` in `app/lib/search/verdict.ts`, `planClassifyFilePass` in `app/lib/corpus/sync-topics.ts`, `generateFileHydes` and `describeGroup` in `app/lib/corpus/`. Nothing here is a second implementation of anything.

Deriving the region input by hand was rejected. `app/lib/regions/sync.ts` already turns a document into units and a unit into a `FindWork` — the adapter uses the same functions in the same order rather than a parallel derivation that would drift the first time the cutting rule changes.

## Tests

**Skeleton.** `region-finder` carries the skeleton: it is the agent the walking skeleton runs.

**Contract**, riskiest first.

- Given a hits file whose contents are not the shape `region-finder` produces — a missing `value`, a `hitSentence` that is not a number, a bare object — when `region-marker` parses it, then the run stops with a usage error naming the field, and no call is made.
- Given a hits file naming a `hitSentence` past the end of the document, when `region-marker` runs, then `computeWindows` drops it as unlocatable, no `MarkWork` is built for it, and the constructed marks omit it.
- Given a file passed by an absolute path, when any agent runs, then every `file` attribute in the request bodies is the basename alone.
- Given a `--kind` that is not in `regionKinds()`, when any region agent starts, then the run stops with a usage error listing the registered ids, and no call is made.
- Given a file with several named people spanning more than one scan unit, when `region-finder` runs, then one `FindWork` exists per unit, each carrying only that unit's sentences, and each hit's `hitSentence` is an index into the whole document rather than into its unit.
- Given `--known` naming two values, when `region-finder` runs, then the known-value message in the request lists them, and given the flag is absent, then the request carries the no-known-values message instead.
- Given a file `shouldReclassify` declines, when `topic-assigner` runs, then no call is made and the constructed output is absent rather than empty.
- Given a directory whose samples total fewer than 500 words, when `corpus-describer` runs, then no call is made and the constructed output is the joined samples.
- Given `region-pass` over a file with no stored regions, when it runs, then the constructed block carries the found rows and the `scanned` list, and nothing is written to disk.
- Given `region-pass` over a file whose `json-regions` block already scans every unit under the current rules hash, when it runs, then no call is made and the constructed block is the one already stored — while `region-finder` over the same file calls for every unit.

The first three are usage errors that must cost nothing. An agent that discovers a bad flag only after spending a call has wasted money and time in a loop whose whole point is being cheap to repeat.

**Isolation.** Every adapter runs with the recorder installed over a stub `fetch` serving canned replies, exactly as in [recorder.md](recorder.md). No gateway is contacted and no file is written; the fixtures are markdown strings and the assertions are on the requests that went out and the artifact that came back. `region-pass` additionally asserts its capturing `writeRegions` was called and the filesystem was not.
