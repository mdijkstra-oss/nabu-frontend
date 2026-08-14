import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"
import { withRouter, withSeededFiles } from "../../../../.storybook/decorators"
import { indexFileSentences } from "~/lib/text/halo"
import { stripMarkdown } from "~/lib/text/strip"
import { MilkdownEditor } from "~/ui/components/editor/MilkdownEditor"

interface RegionSpec {
  kind: "speaker" | "date"
  value: string
  quote: string
  hit: string | number
  start: string | number
  end: string | number
}

// A sentence row carries its inline markdown, so a story naming a sentence by the words a
// reader sees has to look past the syntax to find it.
const sentenceIndex = (prose: string, at: string | number): number =>
  typeof at === "number"
    ? at
    : indexFileSentences(prose).findIndex((s) => stripMarkdown(s.text).includes(at))

const toRow = (prose: string, spec: RegionSpec) => ({
  kind: spec.kind,
  parsed: { type: spec.kind === "date" ? "datetime" : "string", value: spec.value },
  quote: spec.quote,
  hitSentence: sentenceIndex(prose, spec.hit),
  startSentence: sentenceIndex(prose, spec.start),
  endSentence: sentenceIndex(prose, spec.end),
  rangeHash: `story-${spec.kind}-${spec.value}`,
})

const fencedBlock = (language: string, payload: unknown): string =>
  ["", "```" + language, JSON.stringify(payload), "```", ""].join("\n")

const withRegions = (prose: string, specs: RegionSpec[]): string =>
  prose + fencedBlock("json-regions", { regions: specs.map((s) => toRow(prose, s)), scanned: {} })

const TRANSCRIPT = [
  "# Interview transcript",
  "",
  "Rutte: yeah, it was quite the event.",
  "",
  "The room was full of people.",
  "",
  "This is great, said Rutte.",
  "",
].join("\n")

const speaker = (overrides: Partial<RegionSpec>): RegionSpec => ({
  kind: "speaker",
  value: "rutte",
  quote: "Rutte",
  hit: "yeah, it was quite",
  start: "yeah, it was quite",
  end: "room was full",
  ...overrides,
})

const FILE_PATH = "transcript.md"

const proseMirror = async (root: HTMLElement): Promise<HTMLElement> =>
  waitFor(() => {
    const el = root.querySelector<HTMLElement>(".ProseMirror")
    if (!el) throw new Error("ProseMirror not mounted yet")
    return el
  })

const labelsFor = (root: HTMLElement, index: number): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`.region-label[data-region-index="${index}"]`))

const labelText = (root: HTMLElement, index: number): string =>
  labelsFor(root, index)
    .map((el) => el.textContent ?? "")
    .join("")

const awaitLabels = async (root: HTMLElement, count: number): Promise<HTMLElement[]> =>
  waitFor(() => {
    const labels = Array.from(
      root.querySelectorAll<HTMLElement>(".region-label[data-region-index]")
    )
    expect(labels.length).toBe(count)
    return labels
  })

// The tint is split into one span per text node, so a nested label breaks a sentence
// into neighbouring spans; joining and collapsing puts it back the way a reader sees it.
const tintedText = (root: HTMLElement): string =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-region-tint]"))
    .map((el) => el.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

const blockOf = (root: HTMLElement, needle: string): HTMLElement => {
  const found = Array.from(root.querySelectorAll<HTMLElement>("p, h1, h2")).find((el) =>
    (el.textContent ?? "").includes(needle)
  )
  if (!found) throw new Error(`no block containing "${needle}"`)
  return found
}

const meta: Meta<typeof MilkdownEditor> = {
  title: "Custom/Editor/Regions",
  component: MilkdownEditor,
}

export default meta
type Story = StoryObj<typeof MilkdownEditor>

const editorStory = (content: string): Story => ({
  args: { content, filePath: FILE_PATH, onChange: fn() },
  decorators: [
    withSeededFiles({ [FILE_PATH]: content }),
    withRouter(`/project/demo-project/file/${FILE_PATH}`),
  ],
})

const ONE_REGION = withRegions(TRANSCRIPT, [speaker({})])

export const OneRegion: Story = {
  ...editorStory(ONE_REGION),
  play: async ({ canvasElement, args }) => {
    const editor = await proseMirror(canvasElement)
    await awaitLabels(editor, 1)

    const [label] = labelsFor(editor, 0)
    expect(label.getAttribute("data-region-kind")).toBe("speaker")
    expect(label.getAttribute("aria-label")).toBe("speaker: rutte")
    expect(labelText(editor, 0)).toBe("Rutte:")
    expect(editor.querySelector('[data-region-icon="speaker"]')).not.toBeNull()

    expect(blockOf(editor, "quite the event").textContent).toBe(
      "Rutte: yeah, it was quite the event."
    )

    const before = (args.onChange as ReturnType<typeof fn>).mock.calls.length
    await userEvent.hover(label)
    await waitFor(() => expect(tintedText(editor)).toContain("quite the event"))
    expect(tintedText(editor)).toContain("The room was full of people.")
    expect(tintedText(editor)).not.toContain("This is great")
    expect((args.onChange as ReturnType<typeof fn>).mock.calls.length).toBe(before)

    await userEvent.unhover(label)
    await userEvent.hover(blockOf(editor, "This is great"))
    await waitFor(() => expect(tintedText(editor)).toBe(""))
  },
}

const searchIconIn = async (root: HTMLElement): Promise<HTMLElement> =>
  waitFor(() => {
    const el = root.querySelector<HTMLElement>("[data-region-search]")
    if (!el) throw new Error("no search icon shown")
    return el
  })

export const SearchOnHoveredIcon: Story = {
  ...editorStory(ONE_REGION),
  args: { ...editorStory(ONE_REGION).args, onRegionSearch: fn() },
  play: async ({ canvasElement, args }) => {
    const editor = await proseMirror(canvasElement)
    await awaitLabels(editor, 1)

    expect(editor.querySelector("[data-region-search]")).toBeNull()

    await userEvent.hover(labelsFor(editor, 0)[0])
    const icon = await searchIconIn(editor)
    expect(icon.getAttribute("aria-label")).toBe("Search speaker: rutte")

    await userEvent.click(icon)
    const onRegionSearch = args.onRegionSearch as ReturnType<typeof fn>
    await waitFor(() => expect(onRegionSearch.mock.calls.length).toBe(1))
    const region = onRegionSearch.mock.calls[0][0]
    expect(region.kind).toBe("speaker")
    expect(region.value).toBe("rutte")

    await userEvent.unhover(icon)
    await userEvent.hover(blockOf(editor, "This is great"))
    await waitFor(() => expect(editor.querySelector("[data-region-search]")).toBeNull())
  },
}

const ONE_SENTENCE = [
  "# Notes",
  "",
  "John on Friday 2nd said the room was ready.",
  "",
  "Nothing else happened.",
  "",
].join("\n")

export const TwoLabelsInOneSentence: Story = {
  ...editorStory(
    withRegions(ONE_SENTENCE, [
      speaker({
        value: "john",
        quote: "John",
        hit: "Friday 2nd",
        start: "Friday 2nd",
        end: "Friday 2nd",
      }),
      {
        kind: "date",
        value: "2026-08-02",
        quote: "Friday 2nd",
        hit: "Friday 2nd",
        start: "Friday 2nd",
        end: "Friday 2nd",
      },
    ])
  ),
  play: async ({ canvasElement }) => {
    const editor = await proseMirror(canvasElement)
    const labels = await awaitLabels(editor, 2)

    expect(labels.map((el) => el.getAttribute("data-region-kind"))).toEqual(["speaker", "date"])
    expect(labelText(editor, 0)).toBe("John")
    expect(labelText(editor, 1)).toBe("Friday 2nd")
    expect(labels[1].getAttribute("aria-label")).toContain("date: ")
    expect(editor.querySelector('[data-region-icon="speaker"]')).not.toBeNull()
    expect(editor.querySelector('[data-region-icon="date"]')).not.toBeNull()
    expect(blockOf(editor, "Friday 2nd").textContent).toBe(
      "John on Friday 2nd said the room was ready."
    )
  },
}

export const TrailingAttribution: Story = {
  ...editorStory(
    withRegions(TRANSCRIPT, [
      speaker({
        quote: "said Rutte",
        hit: "This is great",
        start: "room was full",
        end: "This is great",
      }),
    ])
  ),
  play: async ({ canvasElement }) => {
    const editor = await proseMirror(canvasElement)
    await awaitLabels(editor, 1)

    expect(labelText(editor, 0)).toBe("said Rutte.")
    expect(blockOf(editor, "room was full").querySelector("[data-region-index]")).toBeNull()

    await userEvent.hover(labelsFor(editor, 0)[0])
    await waitFor(() => expect(tintedText(editor)).toContain("The room was full of people."))
    expect(tintedText(editor)).toContain("said Rutte")
    expect(tintedText(editor)).not.toContain("quite the event")
  },
}

const BOLD_PROSE = [
  "# Notes",
  "",
  "This is great, said **Rutte** in the room.",
  "",
  "Nothing else happened.",
  "",
].join("\n")

export const QuoteInsideBold: Story = {
  ...editorStory(
    withRegions(BOLD_PROSE, [
      speaker({ hit: "said Rutte", start: "said Rutte", end: "said Rutte" }),
    ])
  ),
  play: async ({ canvasElement }) => {
    const editor = await proseMirror(canvasElement)
    await awaitLabels(editor, 1)

    const [label] = labelsFor(editor, 0)
    expect(labelText(editor, 0)).toBe("Rutte")
    expect(label.closest("strong") ?? label.querySelector("strong")).not.toBeNull()
    expect(blockOf(editor, "said Rutte").textContent).toBe("This is great, said Rutte in the room.")
  },
}

export const OverlappingKinds: Story = {
  ...editorStory(
    withRegions(TRANSCRIPT, [
      speaker({ end: "This is great" }),
      {
        kind: "date",
        value: "2026-08-02",
        quote: "room was full",
        hit: "room was full",
        start: "room was full",
        end: "room was full",
      },
    ])
  ),
  play: async ({ canvasElement }) => {
    const editor = await proseMirror(canvasElement)
    const labels = await awaitLabels(editor, 2)

    await userEvent.hover(labels[0])
    await waitFor(() => expect(tintedText(editor)).toContain("quite the event"))
    expect(tintedText(editor)).toContain("The room was full of people.")
    expect(tintedText(editor)).toContain("This is great")
    expect(labelText(editor, 1)).toBe("room was full")
    expect(labelsFor(editor, 1)[0].style.color).toBe("")

    await userEvent.unhover(labels[0])
    const dateLabel = await waitFor(() => {
      const [el] = labelsFor(editor, 1)
      if (!el || el.style.color === "") throw new Error("date label pill not redrawn yet")
      return el
    })
    expect(labelText(editor, 1)).toBe("room was full")

    await userEvent.hover(dateLabel)
    await waitFor(() => expect(tintedText(editor)).not.toContain("quite the event"))
    expect(tintedText(editor)).toContain("The room was full of people.")
    expect(tintedText(editor)).not.toContain("This is great")
  },
}

export const StaleRegion: Story = {
  ...editorStory(
    withRegions(TRANSCRIPT, [
      speaker({ quote: "Wilders", hit: 40, start: 40, end: 41 }),
      speaker({
        quote: "said Rutte",
        hit: "This is great",
        start: "This is great",
        end: "This is great",
      }),
    ])
  ),
  play: async ({ canvasElement }) => {
    const editor = await proseMirror(canvasElement)
    await awaitLabels(editor, 1)

    expect(labelText(editor, 1)).toBe("said Rutte.")
    expect(labelsFor(editor, 0)).toHaveLength(0)
  },
}

const ANNOTATED =
  TRANSCRIPT +
  fencedBlock("json-annotations", {
    annotations: [
      { text: "Rutte: yeah", reason: "opening turn", color: "green", id: "ann-1", locked: true },
    ],
  })

export const LabelBesideAnnotationMarker: Story = {
  ...editorStory(withRegions(ANNOTATED, [speaker({})])),
  play: async ({ canvasElement }) => {
    const editor = await proseMirror(canvasElement)
    await awaitLabels(editor, 1)

    const { icon, lock } = await waitFor(() => {
      const found = {
        icon: editor.querySelector<HTMLElement>('[data-region-icon="speaker"]'),
        lock: editor.querySelector<HTMLElement>('[aria-label="Locked annotation"]'),
      }
      if (!found.icon || !found.lock) throw new Error("markers not drawn yet")
      return { icon: found.icon, lock: found.lock }
    })

    expect(lock.textContent).toBe("")
    expect(icon.compareDocumentPosition(lock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(blockOf(editor, "quite the event").textContent).toBe(
      "Rutte: yeah, it was quite the event."
    )
  },
}
