import { describe, it, expect, vi, afterEach } from "vitest"
import { getApiUrl, getWsUrl } from "./env"

const stubPage = (protocol: string, host: string): void => {
  vi.stubGlobal("window", { location: { protocol, host } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("getApiUrl / getWsUrl", () => {
  const cases: {
    name: string
    apiHost: string | undefined
    protocol: string
    host: string
    api: string
    ws: string
  }[] = [
    {
      name: "same-origin prefix on an https page uses https/wss and the page host",
      apiHost: "/api",
      protocol: "https:",
      host: "192.168.1.20:8443",
      api: "https://192.168.1.20:8443/api/queries/projects",
      ws: "wss://192.168.1.20:8443/api/ws/p1",
    },
    {
      name: "same-origin prefix on an http page uses http/ws",
      apiHost: "/api",
      protocol: "http:",
      host: "192.168.1.20:8090",
      api: "http://192.168.1.20:8090/api/queries/projects",
      ws: "ws://192.168.1.20:8090/api/ws/p1",
    },
    {
      name: "trailing slash on the prefix is stripped, joining with a single slash",
      apiHost: "/api/",
      protocol: "http:",
      host: "192.168.1.20:8090",
      api: "http://192.168.1.20:8090/api/queries/projects",
      ws: "ws://192.168.1.20:8090/api/ws/p1",
    },
    {
      name: "bare host on an http page keeps today's output",
      apiHost: "localhost:8080",
      protocol: "http:",
      host: "localhost:5173",
      api: "http://localhost:8080/queries/projects",
      ws: "ws://localhost:8080/ws/p1",
    },
    {
      name: "bare host on an https page keeps today's https/wss output",
      apiHost: "localhost:8080",
      protocol: "https:",
      host: "localhost:5173",
      api: "https://localhost:8080/queries/projects",
      ws: "wss://localhost:8080/ws/p1",
    },
    {
      name: "empty string falls through to the localhost default, never same-origin",
      apiHost: "",
      protocol: "http:",
      host: "localhost:5173",
      api: "http://localhost:8080/queries/projects",
      ws: "ws://localhost:8080/ws/p1",
    },
    {
      name: "unset falls through to the localhost default",
      apiHost: undefined,
      protocol: "http:",
      host: "localhost:5173",
      api: "http://localhost:8080/queries/projects",
      ws: "ws://localhost:8080/ws/p1",
    },
  ]

  it.each(cases)("$name", ({ apiHost, protocol, host, api, ws }) => {
    vi.stubEnv("VITE_API_HOST", apiHost)
    stubPage(protocol, host)
    expect(getApiUrl("/queries/projects")).toBe(api)
    expect(getWsUrl("/ws/p1")).toBe(ws)
  })
})
