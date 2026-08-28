import { afterEach, describe, expect, it } from "vitest"
import { getBlock } from "~/lib/data-blocks/query"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { getFileRaw, setFiles, setPersistEnabled } from "~/lib/files/store"
import { respondingWith } from "~/lib/calls/parse.fixture"
import { executeDeepAnalysis } from "./handler"
import "~/lib/agent/tools/block-tools/register"

const code = [
  "```json-callout",
  JSON.stringify({
    id: "themes",
    type: "codebook-code",
    title: "Themes",
    content: "Code definition",
    color: "blue",
    collapsed: false,
  }),
  "```",
].join("\n")

describe("shared coding pipeline writer", () => {
  afterEach(() => setFiles({}))

  it("serializes coder selections through patch_annotations and the existing finalizer", async () => {
    setPersistEnabled(false)
    setFiles({
      "doc.md": "First sentence. Second sentence. Third sentence.",
      "framework.md": "Apply the definitions carefully.",
      "themes.md": code,
    })
    const { parse } = respondingWith(() => ({
      results: [{ code: "themes", start: "1.2", end: "1.2", reason: "matches" }],
    }))

    const result = await executeDeepAnalysis(
      {
        targets: [{ path: "doc.md" }],
        source_files: [
          { path: "framework.md", scope: "framework" },
          { path: "themes.md", scope: "dimension" },
        ],
        post_action: "annotate_as_code",
      },
      {
        passthrough: new Set(["retrieval", "semantic-filter"]),
        coders: ["voter-one"],
        adjudicate: false,
      },
      { parse }
    )

    expect(result.status).toBe("ok")
    const block = getBlock(getFileRaw("doc.md"), "json-annotations", AnnotationsBlockSchema)
    expect(block?.annotations).toEqual([
      expect.objectContaining({ text: "Second sentence.", reason: "matches", code: "themes" }),
    ])
  })
})
