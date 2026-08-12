import { describe, it, expect, vi, afterEach } from "vitest"
import { UNCACHEABLE_ENDPOINTS } from "~/lib/agent/client/fetch"
import { FIND_ENDPOINT, runFind } from "./find"
import { MARK_ENDPOINT } from "./mark"
import type { FindWork } from "./types"

const item: FindWork = {
  file: "talk.md",
  unit: { firstSentence: 0, lastSentence: 0, charStart: 0, charEnd: 0, hash: "h0" },
  sentences: ["Rutte opened the meeting."],
}

const speaker = {
  id: "speaker",
  rules: "A speaker is the person whose words a passage carries.",
  icon: "mic" as const,
  color: "indigo",
  valueType: "string" as const,
}

const streaming = (text: string): Response =>
  new Response(`event: response.output_text.delta\ndata: ${JSON.stringify({ delta: text })}\n\n`, {
    status: 200,
  })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("the retry reaches the transport", () => {
  it("issues a second request when the first response is malformed but well-formed HTTP", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    const fetchMock = vi.fn(async () => streaming("this is not json"))
    vi.stubGlobal("fetch", fetchMock)

    const answered: FindWork[] = []
    const result = await runFind([item], {
      kind: speaker,
      knownValues: new Set(),
      onAnswered: (work) => answered.push(work),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(answered).toEqual([])
    expect(result.unrecorded).toEqual([item])
  })
})

describe("UNCACHEABLE_ENDPOINTS", () => {
  it("holds both detection routes, so a retry is never served from the body-keyed cache", () => {
    expect(UNCACHEABLE_ENDPOINTS).toContain(FIND_ENDPOINT)
    expect(UNCACHEABLE_ENDPOINTS).toContain(MARK_ENDPOINT)
  })
})
