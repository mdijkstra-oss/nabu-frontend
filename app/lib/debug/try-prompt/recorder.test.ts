import { afterEach, describe, expect, it } from "vitest"
import type { Block } from "~/lib/agent/client/blocks"
import { extractText } from "~/lib/agent/client/convert"
import { initialParseState, processLine, stateToBlocks } from "~/lib/agent/client/parse"
import {
  eventStreamBody,
  gatewayError,
  gatewayUrl,
  htmlErrorPage,
  installStubFetch,
  modelError,
  streamingText,
  type Respond,
  type StubFetch,
} from "./fetch.fixture"
import { installRecorder, installedRecorder, type RecorderHandle } from "./recorder"

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const post = (url: string, body: string): Promise<Response> =>
  globalThis.fetch(url, { method: "POST", body })

const readAsTheAppDoes = async (
  response: Response
): Promise<{ bytes: string; blocks: Block[] }> => {
  if (!response.body) throw new Error("No response body")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = ""
  let buffer = ""
  let state = initialParseState()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    bytes += chunk
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) if (line.trim()) state = processLine(line, state, {})
  }
  if (buffer.trim()) state = processLine(buffer, state, {})
  return { bytes, blocks: stateToBlocks(state) }
}

const streamingEvent = (event: string, data: unknown): Response =>
  new Response(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })

const gatewayErrorMessage = (body: string): string =>
  (JSON.parse(body) as { error: { message: string } }).error.message

interface Installed {
  stub: StubFetch
  recorder: RecorderHandle
}

describe("installRecorder", () => {
  const installed: Installed[] = []

  const install = (respond: Respond): Installed => {
    const stub = installStubFetch(respond)
    const recorder = installRecorder()
    installed.push({ stub, recorder })
    return { stub, recorder }
  }

  afterEach(() => {
    for (const { stub, recorder } of installed.reverse()) {
      recorder.uninstall()
      stub.restore()
    }
    installed.length = 0
  })

  describe("failures leave the body for the app to read", () => {
    const html = "<html><body>Bad gateway</body></html>"
    const cases = [
      {
        name: "an HTML error page",
        respond: () => htmlErrorPage(502, html),
        body: html,
        failure: [/HTTP 502/, /Bad gateway/],
      },
      {
        name: "a gateway error object",
        respond: () => gatewayError(401, "missing OPENAI_API_KEY", "config"),
        body: JSON.stringify({ error: { message: "missing OPENAI_API_KEY", type: "config" } }),
        failure: [/HTTP 401/, /config: missing OPENAI_API_KEY/],
      },
      {
        name: "a 200 that is not an event stream",
        respond: () => new Response("upstream key rejected", { status: 200 }),
        body: "upstream key rejected",
        failure: [/HTTP 200/, /upstream key rejected/],
      },
      {
        name: "a well-formed stream carrying a model error",
        respond: () => modelError("blocked by safety", "SAFETY"),
        body: undefined,
        failure: [/blocked by safety/],
      },
      {
        name: "a well-formed stream with no text",
        respond: () => streamingText(""),
        body: undefined,
        failure: [/HTTP 200/, /not an event stream/],
      },
      {
        name: "a well-formed stream whose only block is reasoning",
        respond: () => streamingEvent("response.reasoning_summary_text.delta", { delta: "hm" }),
        body: undefined,
        failure: [/no text/, /reasoning/],
      },
    ]

    it.each(cases)("$name", async ({ respond, body, failure }) => {
      const { recorder } = install(respond)
      const response = await post(gatewayUrl("/region-finder"), "{}")
      const read = await response.text()
      const [call] = await recorder.drain()

      if (body !== undefined) expect(read).toBe(body)
      expect(call.reply).toBeUndefined()
      for (const pattern of failure) expect(call.failure).toMatch(pattern)
    })

    it("lets the app parse the gateway error object from the original body", async () => {
      install(() => gatewayError(401, "missing OPENAI_API_KEY", "config"))
      const response = await post(gatewayUrl("/region-finder"), "{}")
      expect(gatewayErrorMessage(await response.text())).toBe("missing OPENAI_API_KEY")
    })
  })

  it("records a rejected fetch and rethrows the same error", async () => {
    const error = new TypeError("fetch failed")
    const { recorder } = install(() => {
      throw error
    })
    await expect(post(gatewayUrl("/region-finder"), "{}")).rejects.toBe(error)
    const [call] = await recorder.drain()
    expect(call.reply).toBeUndefined()
    expect(call.failure).toMatch(/fetch failed/)
  })

  it("hands the app every byte and records the text the app parsed", async () => {
    const text = 'Line one\n{"hits":[1,2]}'
    const { recorder } = install(() => streamingText(text))
    const response = await post(gatewayUrl("/region-finder"), '{"input":[]}')
    const { bytes, blocks } = await readAsTheAppDoes(response)
    const [call] = await recorder.drain()

    expect(bytes).toBe(eventStreamBody(text))
    expect(call.reply).toBe(extractText(blocks))
    expect(call.failure).toBeUndefined()
    expect(call).toMatchObject({ index: 1, endpoint: "/region-finder", request: '{"input":[]}' })
  })

  it("keeps dispatch order and pairing when calls complete out of order", async () => {
    const gates = [deferred<Response>(), deferred<Response>()]
    const { recorder } = install((_request, ordinal) => gates[ordinal - 1].promise)

    const first = post(gatewayUrl("/region-finder"), '{"n":1}')
    const second = post(gatewayUrl("/region-marker"), '{"n":2}')
    gates[1].resolve(streamingText("second"))
    await second
    gates[0].resolve(streamingText("first"))
    await first

    expect(await recorder.drain()).toEqual([
      { index: 1, endpoint: "/region-finder", request: '{"n":1}', reply: "first" },
      { index: 2, endpoint: "/region-marker", request: '{"n":2}', reply: "second" },
    ])
  })

  it.each([["https://example.org/x"], [`${gatewayUrl("")}0/x`]])(
    "forwards a fetch to another origin without recording it: %s",
    async (url) => {
      const { stub, recorder } = install(() => new Response("elsewhere", { status: 200 }))
      const response = await post(url, '{"q":1}')

      expect(await response.text()).toBe("elsewhere")
      expect(stub.requests).toEqual([{ url, body: '{"q":1}' }])
      expect(await recorder.drain()).toEqual([])
    }
  )

  it("records each of two byte-identical requests", async () => {
    const { recorder } = install(() => streamingText("same"))
    await post(gatewayUrl("/region-finder"), '{"same":true}')
    await post(gatewayUrl("/region-finder"), '{"same":true}')

    const calls = await recorder.drain()
    expect(calls.map((call) => call.index)).toEqual([1, 2])
    expect(calls.map((call) => call.request)).toEqual(['{"same":true}', '{"same":true}'])
  })

  it("empties the buffer on drain and numbers the next call from 1 again", async () => {
    const { recorder } = install(() => streamingText("ok"))
    await post(gatewayUrl("/region-finder"), "{}")
    expect(await recorder.drain()).toHaveLength(1)
    expect(await recorder.drain()).toEqual([])
    await post(gatewayUrl("/region-finder"), "{}")
    expect((await recorder.drain()).map((call) => call.index)).toEqual([1])
  })

  it("waits for a call still in flight when drained", async () => {
    const gate = deferred<Response>()
    const { recorder } = install(() => gate.promise)
    const pending = post(gatewayUrl("/region-finder"), "{}")
    const draining = recorder.drain()
    gate.resolve(streamingText("late"))
    await pending

    expect(await draining).toEqual([
      { index: 1, endpoint: "/region-finder", request: "{}", reply: "late" },
    ])
  })

  // Contract: "`drain()` ... empties the buffer, and restarts the numbering, so the next
  // drain returns only what was recorded since and its first call is `#1` again." The
  // call dispatched while the drain was awaiting is what the next drain starts from.
  it("carries a call dispatched during a drain to the next drain, numbered from 1", async () => {
    const gates = [deferred<Response>(), deferred<Response>(), deferred<Response>()]
    const { recorder } = install((_request, ordinal) => gates[ordinal - 1].promise)

    const first = post(gatewayUrl("/region-finder"), '{"n":1}')
    const draining = recorder.drain()
    const second = post(gatewayUrl("/region-marker"), '{"n":2}')
    gates[0].resolve(streamingText("first"))
    await first

    expect(await draining).toEqual([
      { index: 1, endpoint: "/region-finder", request: '{"n":1}', reply: "first" },
    ])

    gates[1].resolve(streamingText("second"))
    await second
    const third = post(gatewayUrl("/region-pass"), '{"n":3}')
    gates[2].resolve(streamingText("third"))
    await third

    expect(await recorder.drain()).toEqual([
      { index: 1, endpoint: "/region-marker", request: '{"n":2}', reply: "second" },
      { index: 2, endpoint: "/region-pass", request: '{"n":3}', reply: "third" },
    ])
  })

  // Contract: "`failure` — a sentence naming what went wrong. Absent on success. Never
  // both absent." A second drain started while the first is still awaiting splices by a
  // count taken before the first drain shifted the buffer, so it can carry off a call
  // dispatched after its own snapshot, whose outcome it never awaited.
  it("never returns a call with neither reply nor failure when two drains overlap", async () => {
    const gates = [deferred<Response>(), deferred<Response>(), deferred<Response>()]
    const { recorder } = install((_request, ordinal) => gates[ordinal - 1].promise)

    const first = post(gatewayUrl("/region-finder"), '{"n":1}')
    const drainA = recorder.drain()
    const second = post(gatewayUrl("/region-marker"), '{"n":2}')
    const drainB = recorder.drain()

    gates[0].resolve(streamingText("first"))
    await first
    expect(await drainA).toHaveLength(1)

    const third = post(gatewayUrl("/region-pass"), '{"n":3}')
    gates[1].resolve(streamingText("second"))
    await second

    for (const call of await drainB)
      expect(call.reply ?? call.failure, `${call.endpoint} has neither`).toBeDefined()

    gates[2].resolve(streamingText("third"))
    await third
  })

  it("is found by installedRecorder while installed and restores fetch on uninstall", () => {
    const stub = installStubFetch(() => streamingText("ok"))
    const stubbed = globalThis.fetch
    const recorder = installRecorder()
    installed.push({ stub, recorder })

    expect(globalThis.fetch).not.toBe(stubbed)
    expect(installedRecorder()).toBe(recorder)
    recorder.uninstall()
    expect(globalThis.fetch).toBe(stubbed)
    expect(installedRecorder()).toBeUndefined()
  })

  // Contract: "`reply` — the model's text. Absent when the call produced none." — the
  // call below produced text before the stream failed, and callLlm retries content
  // filters, so this is the shape a retry loop leaves behind.
  it("records the text the app got when a stream carries text and then a model error", async () => {
    const body = [
      "event: response.output_text.delta",
      `data: ${JSON.stringify({ delta: "half an answ" })}`,
      "",
      "event: response.failed",
      `data: ${JSON.stringify({ response: { error: { message: "blocked", type: "SAFETY" } } })}`,
      "",
    ].join("\n")
    const { recorder } = install(
      () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
    )
    const response = await post(gatewayUrl("/region-finder"), "{}")
    const { blocks } = await readAsTheAppDoes(response)
    const [call] = await recorder.drain()

    expect(extractText(blocks)).toBe("half an answ")
    expect(call.reply).toBe("half an answ")
    expect(call.failure).toMatch(/blocked/)
  })

  // Contract: "`request` — the JSON body exactly as sent, as the string that went over
  // the wire", for a caller that passes a Request the way `urlOf` already anticipates.
  it("records the body of a Request passed as input", async () => {
    const { recorder } = install(() => streamingText("ok"))
    await globalThis.fetch(
      new Request(gatewayUrl("/region-finder"), { method: "POST", body: '{"a":1}' })
    )
    const [call] = await recorder.drain()
    expect(call).toMatchObject({ endpoint: "/region-finder", request: '{"a":1}' })
  })

  // Same contract line, for a body that is a BodyInit other than a string.
  it("records a body that is not a string", async () => {
    const { recorder } = install(() => streamingText("ok"))
    await globalThis.fetch(gatewayUrl("/region-finder"), {
      method: "POST",
      body: new URLSearchParams({ a: "1" }),
    })
    const [call] = await recorder.drain()
    expect(call.request).toBe("a=1")
  })

  // Contract: "`uninstall()` puts back the `fetch` that was there before" and
  // "`installedRecorder()` returns the handle of the wrapper currently sitting at
  // `globalThis.fetch`, or nothing".
  it("puts back the fetch that was there before when uninstalled out of order", async () => {
    const stub = installStubFetch(() => streamingText("ok"))
    const stubbed = globalThis.fetch
    const outer = installRecorder()
    const inner = installRecorder()
    installed.push({ stub, recorder: outer }, { stub, recorder: inner })

    outer.uninstall()
    inner.uninstall()

    expect(globalThis.fetch).toBe(stubbed)
    expect(installedRecorder()).toBeUndefined()
  })
})

// Contract: the wrapper "forwards everything unchanged", and `request` is "the JSON
// body exactly as sent". A Request carrying a body must reach the inner fetch with its
// body still readable while the recorder captures the same bytes.
describe("a Request input keeps its body for the inner fetch", () => {
  it("gives the inner fetch a readable body and records the same bytes", async () => {
    const previous = globalThis.fetch
    let seen: string | undefined
    globalThis.fetch = async (input) => {
      seen = await (input as Request).text()
      return streamingText("ok")
    }
    const recorder = installRecorder()
    try {
      await globalThis.fetch(
        new Request(gatewayUrl("/region-finder"), { method: "POST", body: '{"a":1}' })
      )
      const [call] = await recorder.drain()
      expect(seen).toBe('{"a":1}')
      expect(call.request).toBe('{"a":1}')
    } finally {
      recorder.uninstall()
      globalThis.fetch = previous
    }
  })
})

// Contract: "`failure` — a sentence naming what went wrong. Absent on success. Never
// both absent." A call dispatched while a drain is awaiting the previous call is
// spliced out of the buffer before its outcome is recorded.
describe("drain does not emit a call it has not finished recording", () => {
  it("never returns a call with neither reply nor failure", async () => {
    const previous = globalThis.fetch
    const gates = [deferred<Response>(), deferred<Response>()]
    let ordinal = 0
    globalThis.fetch = async () => gates[ordinal++].promise
    const recorder = installRecorder()
    let second: Promise<Response> | undefined
    try {
      const first = post(gatewayUrl("/region-finder"), '{"n":1}')
      const draining = recorder.drain()
      second = post(gatewayUrl("/region-marker"), '{"n":2}')
      gates[0].resolve(streamingText("first"))
      await first
      const calls = await draining
      for (const call of calls)
        expect(call.reply ?? call.failure, `call #${call.index} has neither`).toBeDefined()
    } finally {
      gates[1].resolve(streamingText("second"))
      await second
      recorder.uninstall()
      globalThis.fetch = previous
    }
  })
})

// Contract: "`installedRecorder()` returns the handle of the wrapper currently sitting
// at `globalThis.fetch`" — after the top wrapper is uninstalled that is the one below.
describe("installedRecorder with nested wrappers", () => {
  it("finds the wrapper below once the top one is uninstalled", () => {
    const stub = installStubFetch(() => streamingText("ok"))
    const outer = installRecorder()
    const inner = installRecorder()
    try {
      expect(installedRecorder()).toBe(inner)
      inner.uninstall()
      expect(installedRecorder()).toBe(outer)
    } finally {
      outer.uninstall()
      stub.restore()
    }
  })
})

// Contract: "`drain()` resolves to the recorded calls in dispatch order" and "`request`
// — the JSON body exactly as sent". A body that finishes arriving after the response
// does must still be in the drained call.
describe("drain waits for the request body copy", () => {
  it("records a body that resolves later than the response", async () => {
    const previous = globalThis.fetch
    globalThis.fetch = async () => streamingText("ok")
    const recorder = installRecorder()
    try {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode('{"slow":true}'))
            controller.close()
          }, 5)
        },
      })
      await globalThis.fetch(
        new Request(gatewayUrl("/region-finder"), {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit)
      )
      const [call] = await recorder.drain()
      expect(call.request).toBe('{"slow":true}')
    } finally {
      recorder.uninstall()
      globalThis.fetch = previous
    }
  })
})
