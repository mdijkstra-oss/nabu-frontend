import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { chunkFileForEmbedding } from "~/lib/embeddings/chunk"
import type { Message } from "~/lib/calls/messages"
import { textOf } from "~/lib/calls/parse.fixture"
import {
  gatewayUrl,
  installRecordedStub,
  streamingJson,
  type Respond,
  type StubFetch,
} from "../fetch.fixture"
import { UsageError } from "./types"
import { scoutFilter } from "./scout-filter"

const TRANSCRIPT = resolve("scripts/fixtures/try-prompt/transcript.md")
const FRAMEWORK_TEXT = "Only passages where a named person makes a commitment are in scope."

const raw = readFileSync(TRANSCRIPT, "utf8")
const chunkStarts = chunkFileForEmbedding(raw).map((chunk) => chunk.chunkStart)

const runWith = (framework: string) =>
  scoutFilter.run({ files: { "transcript.md": raw }, extras: { framework } })

const messageText = (body: string): string =>
  (JSON.parse(body) as { input: Message[] }).input.map(textOf).join("\n")

describe("scout-filter", () => {
  const scratch = mkdtempSync(join(tmpdir(), "try-prompt-scout-"))
  const frameworkPath = join(scratch, "framework.md")
  const emptyPath = join(scratch, "empty.md")
  let stub: StubFetch
  let teardown: () => Promise<void>
  let respond: Respond = () => streamingJson({ exclude: [] })

  beforeAll(() => {
    writeFileSync(frameworkPath, FRAMEWORK_TEXT)
    writeFileSync(emptyPath, "")
    ;({ stub, teardown } = installRecordedStub((request, ordinal) => respond(request, ordinal)))
  })

  beforeEach(() => stub.requests.splice(0))

  afterAll(async () => {
    await teardown()
    rmSync(scratch, { recursive: true, force: true })
  })

  it.each([
    { name: "missing framework file", framework: join(scratch, "nope.md"), mentions: "nope.md" },
    { name: "empty framework file", framework: emptyPath, mentions: "empty" },
  ])("$name rejects with UsageError before any call", async ({ framework, mentions }) => {
    const rejection = runWith(framework)
    await expect(rejection).rejects.toBeInstanceOf(UsageError)
    await expect(rejection).rejects.toThrow(mentions)
    expect(stub.requests).toEqual([])
  })

  it.each([
    { reply: { exclude: [{ from: 1, to: 1, reason: "meta" }] }, ids: [1] },
    { reply: { exclude: [{ from: 2, to: 3, reason: "meta" }] }, ids: [2, 3] },
    { reply: { exclude: [] }, ids: [] },
  ])("constructs $ids from $reply", async ({ reply, ids }) => {
    respond = () => streamingJson(reply)
    const constructed = await runWith(frameworkPath)
    expect(constructed).toEqual(ids.map((id) => ({ entryId: id, chunkStart: chunkStarts[id - 1] })))
    expect(stub.requests.map((r) => r.url)).toEqual([gatewayUrl("/scout-filter")])
  })

  it("sends the basename as every file attribute and the framework text", async () => {
    respond = () => streamingJson({ exclude: [] })
    await runWith(frameworkPath)
    const text = messageText(stub.requests[0].body)
    expect(text).toContain(FRAMEWORK_TEXT)
    const files = [...text.matchAll(/<entry id="\d+" file="([^"]*)"/g)].map((m) => m[1])
    expect(files).toHaveLength(chunkStarts.length)
    expect(new Set(files)).toEqual(new Set(["transcript.md"]))
  })
})
