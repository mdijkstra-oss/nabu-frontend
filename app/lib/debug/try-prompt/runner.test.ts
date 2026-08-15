import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { commaSeparatedFlag, textFlag } from "./agents/flags"
import { defineAgent, UsageError, type DebugAgent } from "./agents/types"
import {
  gatewayUrl,
  htmlErrorPage,
  installStubFetch,
  streamingText,
  type Respond,
  type StubFetch,
} from "./fetch.fixture"
import { installRecorder, type RecorderHandle } from "./recorder"
import { EXIT_OK, EXIT_RUN_FAILED, EXIT_USAGE, run, type RunIo } from "./runner"

interface Captured {
  io: RunIo
  out: string[]
  err: string[]
  all: string[]
}

const capture = (): Captured => {
  const out: string[] = []
  const err: string[] = []
  const all: string[] = []
  const to = (stream: string[]) => (text: string) => {
    stream.push(text)
    all.push(text)
  }
  return { io: { out: to(out), err: to(err) }, out, err, all }
}

const callGateway = (body: string): Promise<Response> =>
  fetch(gatewayUrl("/v1/responses"), { method: "POST", body })

const echoReply: Respond = (request) => streamingText(`reply to ${request.body}`)

const plain = defineAgent({
  name: "plain",
  summary: "makes one call and constructs a marker",
  input: "file",
  extras: z.object({}),
  constructedLabel: "marker",
  run: async ({ files }) => {
    await callGateway("plain-body")
    return { files: Object.keys(files) }
  },
})

const needle = defineAgent({
  name: "needle",
  summary: "needs a --needle to search for",
  input: "file",
  extras: z.object({
    needle: textFlag("<text>", "the text to look for"),
    tags: commaSeparatedFlag("tags to attach").optional(),
  }),
  constructedLabel: "matches",
  run: async ({ extras }) => {
    await callGateway(extras.needle)
    return { needle: extras.needle, tags: extras.tags ?? [] }
  },
})

const folder = defineAgent({
  name: "folder",
  summary: "reads every markdown file in a directory",
  input: "directory",
  extras: z.object({}),
  constructedLabel: "listing",
  run: async ({ files }) => Object.keys(files),
})

const rejecting = defineAgent({
  name: "rejecting",
  summary: "calls once and then rejects",
  input: "file",
  extras: z.object({}),
  constructedLabel: "nothing",
  run: async () => {
    await callGateway("before-the-crash")
    throw new Error("the adapter fell over")
  },
})

const unreadableHits = defineAgent({
  name: "unreadable-hits",
  summary: "rejects with a usage error before its first call",
  input: "file",
  extras: z.object({}),
  constructedLabel: "nothing",
  run: async () => {
    throw new UsageError("--hits file could not be parsed")
  },
})

const declined = defineAgent({
  name: "declined",
  summary: "finds nothing to ask and makes no call",
  input: "file",
  extras: z.object({}),
  constructedLabel: "verdict",
  run: async () => ({ current: true }),
})

const countingAgent = (): DebugAgent => {
  let iteration = 0
  return defineAgent({
    name: "counting",
    summary: "calls once per iteration with the iteration number",
    input: "file",
    extras: z.object({}),
    constructedLabel: "count",
    run: async () => {
      iteration++
      await callGateway(`iteration-${iteration}`)
      return { iteration }
    },
  })
}

const registry: DebugAgent[] = [plain, needle, folder, rejecting, unreadableHits, declined]

describe("run", () => {
  const scratch = mkdtempSync(join(tmpdir(), "try-prompt-"))
  const filePath = join(scratch, "note.md")
  const dirPath = join(scratch, "notes")
  let stub: StubFetch
  let recorder: RecorderHandle
  let respond: Respond = echoReply

  beforeAll(() => {
    writeFileSync(filePath, "# A note\n")
    mkdirSync(dirPath)
    writeFileSync(join(dirPath, "b.md"), "b")
    writeFileSync(join(dirPath, "a.md"), "a")
    writeFileSync(join(dirPath, "ignored.txt"), "not markdown")
  })

  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  beforeEach(() => {
    respond = echoReply
    stub = installStubFetch((request, ordinal) => respond(request, ordinal))
    recorder = installRecorder()
  })

  afterEach(() => {
    recorder.uninstall()
    stub.restore()
  })

  const runWith = async (argv: string[], agents = registry) => {
    const captured = capture()
    const exit = await run(argv, recorder, agents, captured.io)
    return { exit, out: captured.out.join("\n"), err: captured.err.join("\n") }
  }

  describe("refuses before spending a call", () => {
    const usageCases = [
      {
        name: "an unknown agent",
        argv: () => ["nope", filePath],
        mentions: ["nope", "plain", "needle", "folder"],
      },
      {
        name: "a missing required extra",
        argv: () => ["needle", filePath],
        mentions: ["--needle"],
      },
      {
        name: "a path that does not exist",
        argv: () => ["plain", join(scratch, "missing.md")],
        mentions: ["missing.md"],
      },
      {
        name: "a directory where the agent takes a file",
        argv: () => ["plain", dirPath],
        mentions: ["plain", "directory"],
      },
      {
        name: "a file where the agent takes a directory",
        argv: () => ["folder", filePath],
        mentions: ["folder", "file"],
      },
      {
        name: "no path at all",
        argv: () => ["plain"],
        mentions: ["path"],
      },
      {
        name: "both --replies-only and --constructed-only",
        argv: () => ["plain", filePath, "--replies-only", "--constructed-only"],
        mentions: ["--replies-only", "--constructed-only"],
      },
      {
        name: "a flag nobody declared",
        argv: () => ["needle", filePath, "--needle", "x", "--neddle", "y"],
        mentions: ["--neddle"],
      },
      {
        name: "a --count that is not a whole number",
        argv: () => ["plain", filePath, "--count", "0"],
        mentions: ["--count"],
      },
      {
        name: "a --count given a fractional value",
        argv: () => ["plain", filePath, "--count", "2.5"],
        mentions: ["--count must be a whole number of 1 or more"],
      },
      {
        // runner.md: "--count <n> ... default 1." A negative count is exactly the kind
        // of invalid-but-well-typed argument the flag parse must reject with the
        // count-specific message, not silently misreport a different flag.
        name: "a --count given a negative value",
        argv: () => ["plain", filePath, "--count", "-1"],
        mentions: ["--count must be a whole number of 1 or more"],
      },
      {
        name: "an adapter that throws UsageError",
        argv: () => ["unreadable-hits", filePath],
        mentions: ["--hits file could not be parsed"],
      },
    ]

    it.each(usageCases)(
      "given $name, exits 2 on stderr with no call",
      async ({ argv, mentions }) => {
        const { exit, out, err } = await runWith(argv())
        expect(exit).toBe(EXIT_USAGE)
        expect(stub.requests).toEqual([])
        expect(out).toBe("")
        for (const mention of mentions) expect(err).toContain(mention)
      }
    )

    // runner.md: "In order: the agent name resolves, the path exists and is the kind
    // the agent declared, the extras parse." Given both a bad path and a missing
    // required extra, the path error is what must be printed — the extras parse
    // must never run at all.
    it("given both a bad path and a missing required extra, reports only the path error", async () => {
      const { exit, out, err } = await runWith(["needle", join(scratch, "missing.md")])
      expect(exit).toBe(EXIT_USAGE)
      expect(stub.requests).toEqual([])
      expect(out).toBe("")
      expect(err).toContain("No such file or directory")
      // The extras schema must never run: no zod issue message reaches stderr.
      expect(err).not.toContain("Invalid input")
      expect(err).not.toContain("invalid_type")
    })

    // runner.md: "In order: the agent name resolves, the path exists and is the kind
    // the agent declared, the extras parse." A bare value flag (`--needle` with no
    // value) is caught while parsing the extras, so a bad path must still win and be
    // the only message reported, exactly as it does against a missing required extra.
    it("given both a bad path and a bare value flag, reports only the path error", async () => {
      const { exit, out, err } = await runWith(["needle", join(scratch, "missing.md"), "--needle"])
      expect(exit).toBe(EXIT_USAGE)
      expect(stub.requests).toEqual([])
      expect(out).toBe("")
      expect(err).toContain("No such file or directory")
      expect(err).not.toContain("a value is required")
    })

    it("an unknown agent wins over --help", async () => {
      const { exit, out, err } = await runWith(["nope", "--help"])
      expect(exit).toBe(EXIT_USAGE)
      expect(stub.requests).toEqual([])
      expect(out).toBe("")
      expect(err).toContain("Unknown agent: nope")
    })

    // agents/flags.ts: textFlag is z.string().min(1) with no further shape check, so a
    // flag given with no value — which mri parses as the boolean `true` — stringifies to
    // the literal text "true" and satisfies min(1). The run proceeds and spends a real
    // call on a value the user never typed.
    it('a required text flag given with no value must not silently become the string "true"', async () => {
      const { exit, out } = await runWith(["needle", filePath, "--needle"])
      expect(exit).toBe(EXIT_USAGE)
      expect(stub.requests).toEqual([])
      expect(out).not.toContain('"needle": "true"')
    })

    it("a directory agent given a directory with no .md files makes no call and does not crash", async () => {
      const emptyDir = join(scratch, "empty-notes")
      mkdirSync(emptyDir)
      writeFileSync(join(emptyDir, "not-markdown.txt"), "irrelevant")
      const { exit, out } = await runWith(["folder", emptyDir])
      expect(exit).toBe(EXIT_OK)
      expect(stub.requests).toEqual([])
      expect(out).toContain("[]")
    })
  })

  it("exits 0 when every call was answered and prints the report to stdout", async () => {
    const { exit, out, err } = await runWith(["plain", filePath])
    expect(exit).toBe(EXIT_OK)
    expect(stub.requests.map((request) => request.body)).toEqual(["plain-body"])
    expect(out).toContain("plain-body")
    expect(out).toContain('"note.md"')
    expect(err).toBe("")
  })

  it("exits 1 when one call failed even though the adapter constructed an artifact", async () => {
    respond = () => htmlErrorPage(502)
    const { exit, out } = await runWith(["plain", filePath])
    expect(exit).toBe(EXIT_RUN_FAILED)
    expect(out).toContain("HTTP 502")
    expect(out).toContain('"note.md"')
  })

  it("exits 1 and prints the message when the adapter rejects", async () => {
    const { exit, out } = await runWith(["rejecting", filePath])
    expect(exit).toBe(EXIT_RUN_FAILED)
    expect(out).toContain("the adapter fell over")
    expect(out).toContain("before-the-crash")
  })

  // SEAMS: runner.md exit codes — "1 — the run started but did not complete cleanly:
  // a recorded call failed, or the adapter rejected. 2 — the run never started: ...
  // an adapter that rejected with UsageError before its first call." And: "Every
  // report goes to out, whatever the exit code — a caller redirecting stdout must
  // get the failed run's report as surely as the clean one's." The runner decides 2
  // from the error's class alone (runner.ts runOnce) and never asks the recorder
  // whether a call already went out, so a UsageError thrown after a call is exit 2
  // with the recorded call silently discarded and no report on stdout.
  it("a UsageError thrown after a call was made is a failed run (1) whose report reaches stdout", async () => {
    const lateUsage = defineAgent({
      name: "late-usage",
      summary: "calls once and then throws UsageError",
      input: "file",
      extras: z.object({}),
      constructedLabel: "nothing",
      run: async () => {
        await callGateway("late-usage-body")
        throw new UsageError("--hits looked fine until the call came back")
      },
    })
    const { exit, out } = await runWith(["late-usage", filePath], [lateUsage])
    expect(stub.requests).toHaveLength(1)
    expect(exit).toBe(EXIT_RUN_FAILED)
    expect(out).toContain("late-usage-body")
  })

  it("exits 0 when the app's precondition declined and no call was made", async () => {
    const { exit, out } = await runWith(["declined", filePath])
    expect(exit).toBe(EXIT_OK)
    expect(stub.requests).toEqual([])
    expect(out).toContain('"current": true')
  })

  it("passes parsed extras to the adapter", async () => {
    const { exit, out } = await runWith(["needle", filePath, "--needle", "pin", "--tags", "a, b"])
    expect(exit).toBe(EXIT_OK)
    expect(out).toContain('"needle": "pin"')
    expect(out).toContain('"a",')
    expect(out).toContain('"b"')
  })

  it("hands a directory agent every .md file keyed by basename, sorted", async () => {
    const { exit, out } = await runWith(["folder", dirPath])
    expect(exit).toBe(EXIT_OK)
    expect(out).toContain('[\n  "a.md",\n  "b.md"\n]')
    expect(out).not.toContain("ignored.txt")
  })

  it("repeats under --count with each report carrying only its own calls, exiting the worst", async () => {
    respond = (request) =>
      request.body === "iteration-2"
        ? htmlErrorPage(502)
        : streamingText(`answered ${request.body}`)
    const captured = capture()
    const exit = await run(
      ["counting", filePath, "--count", "3", "--requests"],
      recorder,
      [countingAgent()],
      captured.io
    )
    const reports = captured.all

    expect(exit).toBe(EXIT_RUN_FAILED)
    expect(stub.requests).toHaveLength(3)
    expect(reports).toHaveLength(3)
    expect(captured.out).toHaveLength(3)
    expect(captured.err).toHaveLength(0)
    for (const [i, report] of reports.entries()) {
      expect(report).toContain(`iteration ${i + 1} of 3`)
      expect(report).toContain("1 call,")
      expect(report).toContain(`iteration-${i + 1}`)
      for (const other of [1, 2, 3].filter((n) => n !== i + 1)) {
        expect(report).not.toContain(`iteration-${other}`)
      }
    }
    expect(captured.out[1]).toContain("iteration-2")
    expect(captured.out[1]).toContain("HTTP 502")
  })

  it("prints each iteration's report in full before the next iteration's call is made", async () => {
    const order: string[] = []
    const tracked = defineAgent({
      name: "tracked",
      summary: "records when it is called relative to reports",
      input: "file",
      extras: z.object({}),
      constructedLabel: "marker",
      run: async () => {
        order.push("call")
        await callGateway("tracked-body")
        return {}
      },
    })
    const captured = capture()
    const tracingIo: RunIo = {
      out: (text) => {
        order.push("report")
        captured.io.out(text)
      },
      err: captured.io.err,
    }
    await run(["tracked", filePath, "--count", "3"], recorder, [tracked], tracingIo)
    expect(order).toEqual(["call", "report", "call", "report", "call", "report"])
  })

  // runner.md exit codes: "2 — the run never started ... or an adapter that rejected
  // with UsageError before its first call." Under --count, a UsageError on iteration 2
  // arrives after iteration 1 already made and completed a call — the run plainly
  // started — yet exit 2 is defined for a run that never did, and "--count repeats"
  // implies the remaining iteration still runs.
  it("does not report exit 2 when an iteration's UsageError follows an iteration that already called", async () => {
    let iteration = 0
    const flaky = defineAgent({
      name: "flaky",
      summary: "usage-errors on its second iteration only",
      input: "file",
      extras: z.object({}),
      constructedLabel: "marker",
      run: async () => {
        iteration++
        if (iteration === 2) throw new UsageError("iteration 2 usage error")
        await callGateway(`flaky-${iteration}`)
        return { iteration }
      },
    })
    const captured = capture()
    const exit = await run(["flaky", filePath, "--count", "3"], recorder, [flaky], captured.io)
    expect(exit).not.toBe(EXIT_USAGE)
    expect(stub.requests).toHaveLength(2)
  })

  it.each([[[]], [["--help"]]])("lists every agent and exits 0 for argv %j", async (argv) => {
    const { exit, out, err } = await runWith(argv)
    expect(exit).toBe(EXIT_OK)
    expect(err).toBe("")
    for (const agent of registry) {
      expect(out).toContain(agent.name)
      expect(out).toContain(agent.summary)
    }
    expect(out).toContain("directory")
    expect(stub.requests).toEqual([])
  })

  it("prints an agent's own flags for <agent> --help and exits 0", async () => {
    const { exit, out, err } = await runWith(["needle", "--help"])
    expect(exit).toBe(EXIT_OK)
    expect(err).toBe("")
    expect(out).toContain("--needle <text>")
    expect(out).toContain("the text to look for")
    expect(out).toContain("--tags <a,b,…>")
    expect(out).toContain("--count")
    expect(stub.requests).toEqual([])
  })
})
