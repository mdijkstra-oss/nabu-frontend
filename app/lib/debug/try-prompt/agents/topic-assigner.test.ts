import { readFileSync } from "node:fs"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { block } from "~/lib/data-blocks/test-helpers"
import { contentHash, shouldReclassify } from "~/domain/data-blocks/attributes/topics/selectors"
import {
  gatewayUrl,
  installRecordedStub,
  streamingJson,
  type Respond,
  type StubFetch,
} from "../fetch.fixture"
import { topicAssigner } from "./topic-assigner"

const transcript = readFileSync("scripts/fixtures/try-prompt/transcript.md", "utf8")

const classifiedFile = (prose: string): string => {
  const withHash = (hash: string): string =>
    `${prose}\n\n${block("json-attributes", JSON.stringify({ type: "interview", subject: "housing", hash }))}`
  return withHash(contentHash(withHash("pending")))
}

const messageTextOf = (body: string): string =>
  (JSON.parse(body).input as { content: string }[]).map((m) => m.content).join("\n")

const canned = { type: "Interview", subject: "Housing" }

describe("topic-assigner", () => {
  let stub: StubFetch
  let teardown: () => Promise<void>
  let respond: Respond = () => streamingJson(canned)

  beforeAll(() => {
    ;({ stub, teardown } = installRecordedStub((request, ordinal) => respond(request, ordinal)))
  })
  beforeEach(() => {
    stub.requests.length = 0
    respond = () => streamingJson(canned)
  })
  afterAll(async () => {
    await teardown()
  })

  it("makes no call and constructs nothing for a file that already carries a current classification", async () => {
    const raw = classifiedFile(transcript)
    expect(shouldReclassify(raw)).toBe(false)
    const constructed = await topicAssigner.run({
      files: { "doc.md": raw },
      extras: {},
    })
    expect(stub.requests).toHaveLength(0)
    expect(constructed).toBeUndefined()
  })

  it("classifies a plain file through the real classifyDocument, seeded from --types and --subjects", async () => {
    const constructed = await topicAssigner.run({
      files: { "doc.md": transcript },
      extras: { types: ["a", "b"], subjects: ["c"] },
    })
    expect(stub.requests).toHaveLength(1)
    expect(stub.requests[0].url).toBe(gatewayUrl("/topic-assigner"))
    const text = messageTextOf(stub.requests[0].body)
    expect(text).toContain("Existing types: a, b")
    expect(text).toContain("Existing subjects: c")
    expect(constructed).toEqual({ type: "interview", subject: "housing" })
  })

  it("tells the model there is nothing yet when the flags are absent", async () => {
    await topicAssigner.run({ files: { "doc.md": transcript }, extras: {} })
    const text = messageTextOf(stub.requests[0].body)
    expect(text).toContain("Existing types: (none yet)")
    expect(text).toContain("Existing subjects: (none yet)")
  })
})
