# runner

The runner reads argv, finds the agent, checks everything that can be checked without spending a call, runs it, and decides the exit code. It knows the names of the agents and nothing about what any of them do.

## Contract

`scripts/try-prompt.ts` is a shell. It calls `installHost()` from [host.md](host.md), passes argv and the drain handle that returned to `run`, then exits with what `run` returned. No logic lives in the script, so all of it is testable without a process.

`run(argv, recorder, registry, io)` resolves to an exit code. It reads the first positional as the agent name and the second as the path. The recorder and the registry arrive as arguments rather than as imports so the tests can drive `run` against a stub of each. `io` is `{ out, err }`, defaulting to the console. Every report goes to `out`, whatever the exit code — a caller redirecting stdout must get the failed run's report as surely as the clean one's, because the failure is what it was looking for. Usage errors go to `err`; the help listing goes to `out`. The tests capture both.

The runner is what reads the filesystem: it checks the path, reads the one file or every `.md` in the directory, and builds the `FileStore` keyed by basename that [agents.md](agents.md) describes.

**Base flags**, accepted by every agent:

- `--count <n>` — run the whole invocation `n` times, default 1.
- `--requests` — include the request bodies in the output. Off by default; they are the largest thing on the page and the reader usually wants the reply, not the question.
- `--replies-only` and `--constructed-only` — narrow the output to one end. Mutually exclusive.
- `--help` — print usage and stop.

**Everything else is the agent's**, parsed against the `extras` schema it declares in [agents.md](agents.md). The runner does not know that `region-marker` takes `--hits`; it knows that an agent declares a schema and that argv either satisfies it or does not. A flag that is neither a base flag nor in the schema is a usage error naming it — a misspelt flag must not be silently dropped in a loop whose point is that the flag did something. So is a value flag given bare (`--kind` with nothing after it): `mri` reports it as `true`, and a schema that stringified that would send the word "true" to the model.

**Nothing is spent before everything checkable is checked.** In order: the agent name resolves, the path exists and is the kind the agent declared, the extras parse. Only then does `run` enter the adapter. A loop this tool serves is only cheap if a typo costs a second rather than a call.

**`--count` repeats, and nothing more.** Each iteration is a full invocation: the recorder is drained before it starts so its calls belong to it, and its output is printed in full before the next begins. The runner does not compare iterations, summarize them, or say anything about how they differed. Judging is the reader's, and a tool that scored its own runs would be a tool whose scoring had to be trusted.

**Exit codes** are distinct because a caller branches on them:

- `0` — the run completed and every call was answered.
- `1` — the run started but did not complete cleanly: a recorded call failed, or the adapter rejected.
- `2` — the run never started: unknown agent, missing or wrong-kind path, flags that did not parse, or an adapter that rejected with `UsageError` before its first call (a `--hits` or `--framework` file it could not read or parse).

A run that made zero calls because the app's own precondition declined — `shouldReclassify` saying the file is current, `describeGroup` finding too few words, `region-pass` finding every unit already scanned — exits `0`. It completed; it simply had nothing to ask.

An entry the model never acknowledged is not an exit-code condition. `runRounds` requeues it and abandons it after three misses, and every one of those attempts was a successful call; the gap shows in the constructed artifact having fewer results than the input had units. Making it exit non-zero would mean the adapter reporting a second value that only the exit code reads, to describe an outcome the app treats as normal.

Under `--count`, the exit code is the worst any iteration produced. A `UsageError` is exit `2` only from the first iteration, where nothing has been spent; from a later one it is a rejected iteration like any other, reported and folded in as `1`, and the remaining iterations still run.

**Help is prose.** `try-prompt` with no arguments, or `--help`, lists every agent and exits `0`; the listing with its summary and whether it takes a file or a directory. `try-prompt <agent> --help` prints that agent's flags, generated from its `extras` schema rather than written twice. There is no machine-readable form; the reader is a model and reads prose.

## Prior art

`scripts/debug-chunking.ts` settles the shape of this component. It is committed, it parses with `mri`, it holds a `USAGE` constant, its logic lives in `app/lib/debug/` where it is unit-tested, and it is invoked as `npx vite-node scripts/debug-chunking.ts -- <path> [options]`. This tool follows all five, including the invocation form — `vite-node` is what resolves the `~/` aliases and `import.meta.env` that plain `node` cannot.

`mri` is already a dependency and is enough: one positional agent name, one positional path, flat flags. A parser with subcommand routing — `commander`, `yargs` — would be a new dependency buying nothing, since the agent name is a lookup rather than a command with its own grammar.

An npm script wrapper was rejected. It would need `--` twice to pass flags through, and the direct `vite-node` line is the one the neighbouring script already documents in its own usage text.

## Tests

**Skeleton.** Carries argument parsing, agent resolution and the exit code of the walking skeleton's single invocation.

**Contract**, riskiest first.

- Given an unknown agent name, when `run` is called, then it resolves to `2`, prints the known names, and no call is made.
- Given an agent whose required extra is missing, when `run` is called, then it resolves to `2`, names the missing flag, and no call is made.
- Given a path that does not exist, and given a path that is a directory where the agent declared a file, when `run` is called, then each resolves to `2` before any call.
- Given both `--replies-only` and `--constructed-only`, when `run` is called, then it resolves to `2` naming the conflict.
- Given an agent whose calls all succeed, when `run` is called, then it resolves to `0`.
- Given one call in the run failed, when `run` is called, then it resolves to `1` even though the adapter returned a constructed artifact.
- Given the adapter rejects, when `run` is called, then it resolves to `1` and the rejection's message is printed.
- Given the app's own precondition declined and no call was made, when `run` is called, then it resolves to `0`.
- Given `--count 3`, when `run` is called, then three iterations run, each iteration's output carries only its own calls, and the exit code is the worst of the three.
- Given `--help` with no agent, then every agent is listed and it resolves to `0`; given `--help` after an agent name, then that agent's flags are listed and it resolves to `0`.

The sixth case is the one that earns its place: a run that produced output and also failed a call must not exit `0`, because in a loop the exit code is read before the output is.

**Isolation.** `run` takes its registry as an argument so the tests drive it with one stub agent whose `extras` schema and `run` are written for the case at hand. The recorder sits over a stub `fetch`; no real agent, no gateway, no filesystem beyond a temporary fixture path. Output is captured rather than printed, and asserted through [report.md](report.md)'s own cases rather than re-asserted here.
