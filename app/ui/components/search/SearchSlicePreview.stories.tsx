import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, waitFor } from "storybook/test"
import { withRouter, withSeededFiles, withSize } from "../../../../.storybook/decorators"
import { getRenderableRegionMarks } from "~/domain/regions/selectors"
import { indexFileSentences } from "~/lib/text/halo"
import { SearchSlicePreview } from "./cards"
import { detailHits } from "./fixtures"

const meta: Meta<typeof SearchSlicePreview> = {
  title: "Custom/Search/SearchSlicePreview",
  component: SearchSlicePreview,
  decorators: [
    withSeededFiles({ "field_notes.md": "# Field notes\n\nThe river rose overnight." }),
    withRouter(),
    withSize({ width: "560px" }),
  ],
  args: {
    text: detailHits[0].text,
    filePath: detailHits[0].file,
    spotlights: null,
    onNavigate: fn(),
  },
}

export default meta
type Story = StoryObj<typeof SearchSlicePreview>

export const WithDebugChrome: Story = {
  args: {
    debug: {
      score: detailHits[0].score,
      matchRanges: [
        { confidence: "clear", reasonToKeep: "direct mention of the flood" },
        { confidence: "borderline" },
      ],
      showRawText: true,
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/score: 0\.8123/)).toBeInTheDocument()
    await expect(canvas.getByText("clear")).toBeInTheDocument()
    await expect(canvas.getByText("borderline")).toBeInTheDocument()
    await expect(canvas.getByText("direct mention of the flood")).toBeInTheDocument()
  },
}

export const WithoutDebug: Story = {
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() => expect(canvas.getByText(/impassable until noon/)).toBeInTheDocument())
    expect(canvas.queryByText(/score:/)).toBeNull()
    expect(canvas.queryByText("clear")).toBeNull()
    expect(canvasElement.querySelector("pre")).toBeNull()
  },
}

export const WithoutNavigate: Story = {
  args: {
    onNavigate: undefined,
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector(".lucide-locate-fixed")).toBeNull()
  },
}

const TRANSCRIPT_SNIPPET = "Rutte: yeah, it was quite the event.\n\nThe room was full of people."

const TRANSCRIPT_PROSE = [
  "# Interview transcript",
  "",
  TRANSCRIPT_SNIPPET,
  "",
  "This is great, said Rutte.",
  "",
].join("\n")

const sentenceIndex = (needle: string): number =>
  indexFileSentences(TRANSCRIPT_PROSE).findIndex((s) => s.text.includes(needle))

const TRANSCRIPT_FILE =
  TRANSCRIPT_PROSE +
  [
    "",
    "```json-regions",
    JSON.stringify({
      regions: [
        {
          kind: "person",
          parsed: { type: "string", value: "rutte" },
          quote: "Rutte",
          hitSentence: sentenceIndex("yeah, it was quite"),
          startSentence: sentenceIndex("yeah, it was quite"),
          endSentence: sentenceIndex("This is great"),
          rangeHash: "story-person-rutte",
        },
      ],
      scanned: {},
    }),
    "```",
    "",
  ].join("\n")

export const WithRegionMarks: Story = {
  args: {
    text: TRANSCRIPT_SNIPPET,
    filePath: "transcript.md",
    regions: getRenderableRegionMarks(TRANSCRIPT_FILE),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-region-icon="person"]')).not.toBeNull()
    )
    const label = canvasElement.querySelector('.region-label[data-region-kind="person"]')
    expect(label?.textContent).toBe("Rutte:")
  },
}
