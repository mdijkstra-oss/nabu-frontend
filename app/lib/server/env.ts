import { getEnv } from "~/lib/utils/env"

const getApiHost = (): string => getEnv("VITE_API_HOST", "localhost:8080")

// `/api/` would miss the proxy's exact route and land in the SPA fallback.
const stripTrailingSlash = (prefix: string): string =>
  prefix.endsWith("/") ? prefix.slice(0, -1) : prefix

// A `/`-prefixed host is a same-origin path prefix, resolved against the page's
// own host at runtime. Output stays absolute because `new WebSocket(url)` needs
// an absolute ws(s):// URL.
const buildUrl = (scheme: string, path: string): string => {
  const host = getApiHost()
  return host.startsWith("/")
    ? `${scheme}://${window.location.host}${stripTrailingSlash(host)}${path}`
    : `${scheme}://${host}${path}`
}

export const getApiUrl = (path: string): string =>
  buildUrl(window.location.protocol === "https:" ? "https" : "http", path)

export const getWsUrl = (path: string): string =>
  buildUrl(window.location.protocol === "https:" ? "wss" : "ws", path)
