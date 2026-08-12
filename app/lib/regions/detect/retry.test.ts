import { describe, it, expect, vi, afterEach } from "vitest"
import { UNCACHEABLE_ENDPOINTS } from "~/lib/agent/client/fetch"
import { FIND_ENDPOINT, runFind } from "./find"
import { MARK_ENDPOINT } from "./mark"
import type { FindInput } from "./types"

const input: FindInput = {
  kind: "speaker",
  rules: "A speaker is the person whose words a passage carries.",
  knownValues: [],
  valueType: "string",
  firstSentence: 0,
  sentences: ["Rutte opened the meeting."],
}

const streaming = (text: string): Response =>
  new Response(`event: response.output_text.delta\ndata: ${JSON.stringify({ delta: text })}\n\n`, {
    status: 200,
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the retry reaches the transport", () => {
  it("issues a second request when the first response is malformed but well-formed HTTP", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    const fetchMock = vi.fn(async () => streaming("this is not json"))
    vi.stubGlobal("fetch", fetchMock)

    const outcome = await runFind(input)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(outcome.hits).toEqual([])
    expect(outcome.errors).toHaveLength(1)
  })
})

describe("UNCACHEABLE_ENDPOINTS", () => {
  it("holds both detection routes, so a retry is never served from the body-keyed cache", () => {
    expect(UNCACHEABLE_ENDPOINTS).toContain(FIND_ENDPOINT)
    expect(UNCACHEABLE_ENDPOINTS).toContain(MARK_ENDPOINT)
  })
})
