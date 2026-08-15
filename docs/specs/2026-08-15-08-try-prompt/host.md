# host

The app's model-calling path assumes a browser in three places, and none of them are worth changing for a debug script. `host` is the module that makes a Node process good enough to run that path, and it exists as its own module rather than as a few lines at the top of the script for one reason: static imports hoist above every statement in the file that declares them, so a shim written above an app import does not run above it.

## Contract

`installHost()` — takes nothing, returns the recorder's drain handle described in [recorder.md](recorder.md), and is safe to call more than once. Everything it does is a side effect on process globals, which is exactly why it is at a boundary and named here rather than buried in the runner.

It does three things.

**Installs a `requestAnimationFrame` shim** when the global is absent, invoking the callback on the microtask queue and returning a number. Every gateway call goes through `startRawCall`, which throttles a store notification through `requestAnimationFrame`; in Node that throws and takes the call with it. The shim's timing does not matter because nothing in the tool reads the store it notifies.

**Turns the answer cache off** by calling `setCacheSkipped(true)`. This is not optional and not a flag. Four of the eight routes are cacheable, so without it an edited prompt returns the previous answer out of IndexedDB and the edit looks like it did nothing — the single worst failure mode for the loop this tool exists to serve. It also happens to remove the need for an `indexedDB` shim, because `tryGet` and `tryPut` both return before opening a database when skipping is on.

**Installs the fetch wrapper** from [recorder.md](recorder.md), and returns its drain handle.

No app module needs `requestAnimationFrame` or `indexedDB` at import time — both are reached only when a call runs — so `installHost()` merely has to complete before the run starts. The separate-module rule stands regardless, because relying on that staying true is a bet on code the tool does not own.

Two things are deliberately not the host's business. The gateway address comes from `getLlmHost()`, which reads `VITE_LLM_HOST` and falls back to `http://localhost:8081` — chancery's default port, so the common case needs no configuration and the uncommon one is an environment variable rather than a flag. And the tool is invoked through `npx vite-node`, which is what resolves the `~/` path aliases and `import.meta.env` that plain `node` cannot; that is a fact about the command line, recorded in [runner.md](runner.md) where the usage text lives.

## Prior art

Nothing in the repo does this, because `scripts/debug-chunking.ts` — the closest existing script and the model for this tool's shape — never calls a model and so never touches any of the three globals.

The app's own unit tests run under vitest's `node` environment, which is the standing proof that `app/lib/regions`, `app/lib/calls` and `app/lib/agent/client` import cleanly in Node without a DOM. That is the reason a DOM emulator is the wrong answer here: `jsdom` or `happy-dom` would supply `requestAnimationFrame` and `indexedDB` for real, at the cost of a full DOM implementation, a slower start, and a second environment that has to stay in step with the one the tests already use. Two globals do not justify it.

## Tests

**Skeleton.** Carries the part of the walking skeleton where the process survives its first gateway call: rAF present, cache off, wrapper installed.

**Contract.**

- Given `requestAnimationFrame` is absent from the global scope, when `installHost()` runs, then the global is a function, and a callback passed to it is invoked.
- Given `requestAnimationFrame` is already defined, when `installHost()` runs, then the existing one is left in place.
- Given `installHost()` has already run, when it runs again, then the fetch wrapper is installed exactly once and a subsequent call is recorded once, not twice.
- Given `installHost()` has run, when `tryGet` is called for a cacheable prefix, then it resolves to `undefined` without opening a database.

The third case is the one that matters: a double-installed wrapper doubles every reply in the report, which reads as the model being called twice and sends the reader hunting a retry that never happened.

**Isolation.** Runs in the `node` vitest project with no neighbours faked, because its whole surface is process globals — the test asserts on `globalThis` before and after, and restores what it replaced. The fetch wrapper's own behavior is tested in [recorder.md](recorder.md); here only the fact of its installation is.
