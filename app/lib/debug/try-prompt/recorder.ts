import { getLlmHost } from "~/lib/agent/env"
import { errorMessage } from "~/lib/utils/error"
import { extractText } from "~/lib/agent/client/convert"
import { initialParseState, processLine, stateToBlocks } from "~/lib/agent/client/parse"
import type { Block } from "~/lib/agent/client/blocks"

export interface RecordedCall {
  index: number
  endpoint: string
  request: string
  reply?: string
  failure?: string
}

export interface RecorderHandle {
  drain: () => Promise<RecordedCall[]>
  uninstall: () => void
}

export const installedRecorder = (): RecorderHandle | undefined =>
  installed.get(globalThis.fetch)?.handle

export const installRecorder = (): RecorderHandle => {
  let inner = globalThis.fetch
  const buffer: RecordedCall[] = []
  const inFlight = new Set<Promise<void>>()
  let nextIndex = 1

  const wrapper: typeof fetch = async (input, init) => {
    const url = urlOf(input)
    if (!isGatewayUrl(url)) return inner(input, init)

    const call: RecordedCall = { index: nextIndex++, endpoint: endpointOf(url), request: "" }
    buffer.push(call)
    const body = bodyOf(input, init)
    const forwarded = inner(input, init)
    // Promise reactions run in registration order (ECMA-262), so awaiting `forwarded`
    // here, before it is returned, clones the body before the caller can read it.
    track(inFlight, recordOutcome(call, forwarded))
    track(inFlight, recordRequest(call, body))
    return forwarded
  }

  globalThis.fetch = wrapper
  const handle: RecorderHandle = {
    drain: async () => {
      const taken = new Set(buffer)
      await Promise.all([...inFlight])
      const drained = buffer.filter((call) => taken.has(call))
      buffer.splice(0, buffer.length, ...buffer.filter((call) => !taken.has(call)))
      buffer.forEach((call, i) => (call.index = i + 1))
      nextIndex = buffer.length + 1
      return drained
    },
    uninstall: () => {
      if (globalThis.fetch === wrapper) globalThis.fetch = inner
      else
        for (const above of installed.values()) if (above.inner() === wrapper) above.relink(inner)
      installed.delete(wrapper)
    },
  }
  installed.set(wrapper, {
    handle,
    inner: () => inner,
    relink: (next) => {
      inner = next
    },
  })
  return handle
}

interface Installed {
  handle: RecorderHandle
  inner: () => typeof fetch
  relink: (next: typeof fetch) => void
}

const installed = new Map<typeof fetch, Installed>()

const BODY_PREVIEW_CHARS = 300

interface Outcome {
  reply?: string
  failure?: string
}

export const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url

const isGatewayUrl = (url: string): boolean => {
  const host = getLlmHost()
  return url === host || url.startsWith(`${host}/`)
}

const endpointOf = (url: string): string => url.slice(getLlmHost().length)

const bodyOf = (input: RequestInfo | URL, init: RequestInit | undefined): Promise<string> => {
  const body = init?.body
  if (typeof body === "string") return Promise.resolve(body)
  if (body === undefined || body === null)
    return input instanceof Request ? input.clone().text() : Promise.resolve("")
  if (body instanceof ReadableStream) return Promise.resolve("<streamed body>")
  return new Response(body).text()
}

const recordRequest = async (call: RecordedCall, body: Promise<string>): Promise<void> => {
  call.request = await body
}

const track = (inFlight: Set<Promise<void>>, work: Promise<void>): void => {
  const tracked: Promise<void> = work.finally(() => inFlight.delete(tracked))
  inFlight.add(tracked)
}

const recordOutcome = async (call: RecordedCall, forwarded: Promise<Response>): Promise<void> => {
  Object.assign(call, await outcomeOf(forwarded))
}

const outcomeOf = async (forwarded: Promise<Response>): Promise<Outcome> => {
  let response: Response
  try {
    response = await forwarded
  } catch (error) {
    return { failure: `fetch rejected: ${errorMessage(error)}` }
  }
  return describeResponse(response.clone())
}

const describeResponse = async (response: Response): Promise<Outcome> => {
  const body = await response
    .text()
    .catch((error: unknown) => `<unreadable body: ${errorMessage(error)}>`)
  if (!response.ok)
    return { failure: describeStatus(response.status, gatewayErrorOf(body) ?? preview(body)) }

  const blocks = decodeStream(body)
  if (blocks.length === 0)
    return { failure: describeStatus(response.status, `not an event stream: ${preview(body)}`) }
  const errored = errorBlockOf(blocks)
  const text = extractText(blocks)
  if (errored !== undefined)
    return { ...(text ? { reply: text } : {}), failure: `model error: ${errored}` }
  if (text) return { reply: text }
  return { failure: `reply carried no text, only ${blocks.map((block) => block.type).join(", ")}` }
}

const describeStatus = (status: number, detail: string): string =>
  `HTTP ${status}${detail ? ` — ${detail}` : ""}`

interface GatewayError {
  error?: { message?: string; type?: string }
}

const gatewayErrorOf = (body: string): string | undefined => {
  try {
    const { error } = JSON.parse(body) as GatewayError
    if (error?.message) return error.type ? `${error.type}: ${error.message}` : error.message
  } catch {
    return undefined
  }
  return undefined
}

const preview = (body: string): string => body.slice(0, BODY_PREVIEW_CHARS)

const decodeStream = (body: string): Block[] => {
  let state = initialParseState()
  for (const line of body.split("\n")) {
    if (line.trim()) state = processLine(line, state, {})
  }
  return stateToBlocks(state)
}

const errorBlockOf = (blocks: Block[]): string | undefined => {
  const block = blocks.find((b) => b.type === "error")
  return block?.type === "error" ? block.content : undefined
}
