import { getLlmHost } from "~/lib/agent/env"
import { installHost } from "./host"
import { installedRecorder, urlOf, type RecorderHandle } from "./recorder"

export interface StubRequest {
  url: string
  body: string
}

export type Respond = (request: StubRequest, ordinal: number) => Response | Promise<Response>

export interface StubFetch {
  requests: StubRequest[]
  restore: () => void
}

export interface RecordedStub {
  stub: StubFetch
  recorder: RecorderHandle
  teardown: () => Promise<void>
}

export const eventStreamBody = (text: string): string =>
  [
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ delta: text })}`,
    "",
    "event: response.completed",
    "data: {}",
    "",
  ].join("\n")

export const streamingText = (text: string): Response =>
  new Response(eventStreamBody(text), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })

export const streamingJson = (payload: unknown): Response => streamingText(JSON.stringify(payload))

export const modelError = (message: string, errorType = "SAFETY"): Response =>
  new Response(
    [
      "event: response.failed",
      `data: ${JSON.stringify({ response: { error: { message, type: errorType } } })}`,
      "",
    ].join("\n"),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  )

export const gatewayError = (status: number, message: string, type?: string): Response =>
  new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { "content-type": "application/json" },
  })

export const htmlErrorPage = (
  status: number,
  html = "<html><body>Bad gateway</body></html>"
): Response => new Response(html, { status, headers: { "content-type": "text/html" } })

export const gatewayUrl = (endpoint: string): string => `${getLlmHost()}${endpoint}`

export const installStubFetch = (respond: Respond): StubFetch => {
  const requests: StubRequest[] = []
  const previous = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const request = { url: urlOf(input), body: typeof init?.body === "string" ? init.body : "" }
    requests.push(request)
    return respond(request, requests.length)
  }
  return { requests, restore: () => (globalThis.fetch = previous) }
}

export const installRecordedStub = (respond: Respond): RecordedStub => {
  const stub = installStubFetch(respond)
  const recorder = installHost()
  return {
    stub,
    recorder,
    teardown: async () => {
      await recorder.drain()
      installedRecorder()?.uninstall()
      stub.restore()
    },
  }
}
