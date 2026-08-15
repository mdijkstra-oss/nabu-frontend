import { readFileSync } from "node:fs"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { HYDE_ANGLES, HYDE_COUNT, type HydeAngle } from "~/lib/corpus/hyde-schema"
import { gatewayUrl, installRecordedStub, streamingJson, type StubFetch } from "../fetch.fixture"
import { fileHyde } from "./file-hyde"

const transcript = readFileSync("scripts/fixtures/try-prompt/transcript.md", "utf8")

const hydes: HydeAngle[] = Array.from({ length: HYDE_COUNT }, (_, i) => ({
  type: HYDE_ANGLES[i % HYDE_ANGLES.length],
  text: `passage ${i + 1}`,
}))

const messageTextOf = (body: string): string =>
  (JSON.parse(body).input as { content: string }[]).map((m) => m.content).join("\n")

describe("file-hyde", () => {
  let stub: StubFetch
  let teardown: () => Promise<void>

  beforeAll(() => {
    ;({ stub, teardown } = installRecordedStub(() => streamingJson({ hydes })))
  })
  beforeEach(() => {
    stub.requests.length = 0
  })
  afterAll(async () => {
    await teardown()
  })

  it("sends the file under its basename with the language and constructs the passages", async () => {
    const constructed = await fileHyde.run({
      files: { "doc.md": transcript },
      extras: { language: "Dutch" },
    })
    expect(stub.requests).toHaveLength(1)
    expect(stub.requests[0].url).toBe(gatewayUrl("/file-hyde"))
    const text = messageTextOf(stub.requests[0].body)
    expect(text).toContain('<file name="doc.md">')
    expect(text).not.toContain("/some/absolute/dir")
    expect(text).toContain("language: Dutch")
    expect(constructed).toEqual(hydes)
  })
})
