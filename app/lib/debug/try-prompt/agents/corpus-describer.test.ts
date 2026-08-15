import { readFileSync } from "node:fs"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { CorpusDescription } from "~/domain/corpus/types"
import { gatewayUrl, installRecordedStub, streamingText, type StubFetch } from "../fetch.fixture"
import { corpusDescriber } from "./corpus-describer"

const transcript = readFileSync("scripts/fixtures/try-prompt/transcript.md", "utf8")

const messageTextOf = (body: string): string =>
  (JSON.parse(body).input as { content: string }[]).map((m) => m.content).join("\n")

const extras = { language: "Dutch", corpus: "town-halls" }

describe("corpus-describer", () => {
  let stub: StubFetch
  let teardown: () => Promise<void>

  beforeAll(() => {
    ;({ stub, teardown } = installRecordedStub(() =>
      streamingText("  A corpus of town hall transcripts.  ")
    ))
  })
  beforeEach(() => {
    stub.requests.length = 0
  })
  afterAll(async () => {
    await teardown()
  })

  it("joins the samples without a call when they total fewer than 500 words", async () => {
    const constructed = (await corpusDescriber.run({
      files: { "a.md": "First sample.", "b.md": "Second sample." },
      extras,
    })) as CorpusDescription
    expect(stub.requests).toHaveLength(0)
    expect(constructed.description).toBe("First sample. Second sample.")
    expect(constructed).toMatchObject(extras)
  })

  it("calls the describer with corpus and language when the samples pass 500 words", async () => {
    const constructed = (await corpusDescriber.run({
      files: { "doc.md": transcript },
      extras,
    })) as CorpusDescription
    expect(stub.requests).toHaveLength(1)
    expect(stub.requests[0].url).toBe(gatewayUrl("/corpus-describer"))
    const text = messageTextOf(stub.requests[0].body)
    expect(text).toContain("corpus: town-halls")
    expect(text).toContain("language: Dutch")
    expect(constructed.description).toBe("A corpus of town hall transcripts.")
  })
})
