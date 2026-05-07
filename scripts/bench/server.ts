import { spawn, execSync, type ChildProcess } from "node:child_process"
import { createWriteStream, readFileSync, type WriteStream } from "node:fs"
import { resolve } from "node:path"

const HERMES_LOGOS_DIR = resolve(import.meta.dirname, "../../../hermes-logos")

const loadDotEnv = (dir: string): Record<string, string> => {
  const content = readFileSync(resolve(dir, ".env"), "utf-8")
  const vars: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return vars
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const killOnPort = (port: number): void => {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: "ignore" })
  } catch {}
}

const isPortReady = async (port: number): Promise<boolean> => {
  try {
    await fetch(`http://localhost:${port}/approaches`, {
      signal: AbortSignal.timeout(500),
    })
    return true
  } catch {
    return false
  }
}

export const waitForPort = async (port: number, maxAttempts = 60): Promise<void> => {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isPortReady(port)) return
    await sleep(1000)
  }
  throw new Error(`Port ${port} not ready after ${maxAttempts}s`)
}

export interface ManagedServer {
  port: number
  logStream: WriteStream
  kill: () => void
}

export const spawnServer = (logPath: string, port = 8081): ManagedServer => {
  const logStream = createWriteStream(logPath, { flags: "w" })
  const dotEnv = loadDotEnv(HERMES_LOGOS_DIR)

  const child = spawn("go", ["run", "cmd/main.go"], {
    cwd: HERMES_LOGOS_DIR,
    env: { ...process.env, ...dotEnv, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  })

  child.stdout?.pipe(logStream)
  child.stderr?.pipe(logStream)

  child.on("error", (err) => {
    console.error(`[bench] server process error: ${err.message}`)
  })

  const kill = () => {
    killOnPort(port)
    logStream.end()
  }

  return { port, logStream, kill }
}
