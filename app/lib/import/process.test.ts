import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { getFiles, setFiles, setProjectId } from "~/lib/files/store"
import { EPOCH, ISO, settingsWith } from "~/lib/files/ingest.fixtures"
import { processFiles } from "./process"
import type { ImportFile, ImportStatus } from "./types"

// Node provides the File global but no FileReader.
class StubFileReader {
  result: string | null = null
  error: Error | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  readAsText(file: File): void {
    void file.text().then((text) => {
      this.result = text
      this.onload?.()
    })
  }
}

const createStatusRecorder = () => {
  const perFile: Record<string, ImportStatus[]> = {}
  const record = (id: string, status: ImportStatus): void => {
    ;(perFile[id] ??= []).push(status)
  }
  return { perFile, record }
}

beforeEach(() => {
  vi.stubGlobal("FileReader", StubFileReader)
  setFiles({})
})

afterEach(() => {
  setFiles({})
  vi.unstubAllGlobals()
})

describe("processFiles with an unsupported file", () => {
  const cases: {
    name: string
    dropped: () => File[]
    expectedPaths: string[]
    expectedStatuses: Record<string, string[]>
    existing?: Record<string, string>
  }[] = [
    {
      name: "a lone non-markdown file is never written to the store",
      dropped: () => [new File(["\x89PNG binary bytes"], "photo.png")],
      expectedPaths: [],
      expectedStatuses: { "photo.png": ["unsupported"] },
    },
    {
      name: "the markdown file of a mixed drop lands and the non-markdown one does not",
      dropped: () => [
        new File(["# Note\n\nOne line of prose.\n"], "note.md"),
        new File(["\x89PNG binary bytes"], "photo.png"),
      ],
      expectedPaths: ["note.md"],
      expectedStatuses: {
        "note.md": ["reading", "processing", "pending"],
        "photo.png": ["unsupported"],
      },
    },
    {
      name: "a forged companion filename never reaches ingest",
      dropped: () => [new File(["# Sneak\n"], "x.embeddings.hidden.md")],
      expectedPaths: [],
      expectedStatuses: { "x.embeddings.hidden.md": ["reading", "unsupported"] },
    },
    {
      name: "a mixed-case name that is hidden only after normalization never reaches ingest",
      dropped: () => [new File(["# Sneak\n"], "Notes.Hidden.md")],
      expectedPaths: [],
      expectedStatuses: { "Notes.Hidden.md": ["reading", "unsupported"] },
    },
    {
      name: "a hidden name colliding with an existing file is rejected before dedupe can mask it",
      existing: { "settings.hidden.md": "# Existing settings\n" },
      dropped: () => [new File(["# Sneak\n"], "Settings.Hidden.md")],
      expectedPaths: ["settings.hidden.md"],
      expectedStatuses: { "Settings.Hidden.md": ["reading", "unsupported"] },
    },
    {
      name: "a name the engine excludes by exact match never lands where no event can reach it",
      dropped: () => [new File(["# Sneak\n"], "preferences.md")],
      expectedPaths: [],
      expectedStatuses: { "preferences.md": ["reading", "unsupported"] },
    },
    {
      name: "an excluded name colliding with its store entry is rescued by dedupe as a processable path",
      existing: { "preferences.md": "# Existing preferences\n" },
      dropped: () => [new File(["# Dropped prefs\n"], "preferences.md")],
      expectedPaths: ["preferences-*", "preferences.md"],
      expectedStatuses: { "preferences.md": ["reading", "processing", "pending"] },
    },
  ]

  it.each(cases)("$name", async ({ dropped, expectedPaths, expectedStatuses, existing }) => {
    if (existing) setFiles({ ...existing })
    const recorder = createStatusRecorder()

    await processFiles(dropped(), recorder.record)

    const paths = Object.keys(getFiles()).sort()
    expect(paths).toHaveLength(expectedPaths.length)
    expectedPaths.forEach((expected, i) => {
      if (expected.endsWith("*")) expect(paths[i]).toMatch(new RegExp(`^${expected.slice(0, -1)}`))
      else expect(paths[i]).toBe(expected)
    })
    expect(recorder.perFile).toEqual(expectedStatuses)
  })
})

describe("processFiles with a file ingest rejects", () => {
  it("marks the row error with the validation message and writes nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const recorder = createStatusRecorder()
    let reported: Partial<ImportFile> | undefined
    const corrupt = new File(["# Broken\n\n```json-annotations\n{ not json\n```\n"], "broken.md")

    await processFiles([corrupt], (id, status, extra) => {
      recorder.record(id, status)
      if (status === "error") reported = extra
    })

    expect(recorder.perFile).toEqual({ "broken.md": ["reading", "processing", "error"] })
    expect(getFiles()).toEqual({})
    expect(reported?.error).toMatch(/json-annotations/)
  })
})

describe("processFiles with old-schema content", () => {
  it("stores the migrated form and the server receives it, never the pre-migration bytes", async () => {
    vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost:8080" } })
    const sent: { content?: string }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)) as { content?: string })
        return Promise.resolve(new Response("{}", { status: 200 }))
      })
    )
    vi.useFakeTimers()
    setProjectId("p1")
    vi.stubGlobal("FileReader", StubFileReader)

    try {
      await processFiles([new File([settingsWith(EPOCH)], "note.md")], () => undefined)
      await vi.advanceTimersByTimeAsync(1_000)

      expect(getFiles()["note.md"]).toContain(ISO)
      expect(getFiles()["note.md"]).not.toContain(String(EPOCH))
      expect(sent).toEqual([expect.objectContaining({ path: "note.md" })])
      expect(sent[0].content).toContain(ISO)
      expect(sent[0].content).not.toContain(String(EPOCH))
    } finally {
      setProjectId(null)
      vi.useRealTimers()
    }
  })
})

describe("processFiles with a colliding name", () => {
  it("reports the deduped final path before the write and stores under it", async () => {
    setFiles({ "note.md": "# Existing\n" })
    const recorder = createStatusRecorder()
    let reported: Partial<ImportFile> | undefined

    await processFiles([new File(["# New\n"], "note.md")], (id, status, extra) => {
      recorder.record(id, status)
      if (status === "processing") reported = extra
    })

    const finalPath = reported?.finalPath
    expect(finalPath).toMatch(/^note-[a-z0-9]{4}\.md$/)
    expect(recorder.perFile).toEqual({ "note.md": ["reading", "processing", "pending"] })
    expect(Object.keys(getFiles()).sort()).toEqual(["note.md", finalPath].sort())
  })
})
