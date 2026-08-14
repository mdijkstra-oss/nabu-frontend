import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"
import { withSize } from "../../../.storybook/decorators"
import { WelcomeBackLoading } from "./WelcomeBackLoading"
import type { StageCounterMap } from "~/lib/engine/stage-counters"

const meta: Meta<typeof WelcomeBackLoading> = {
  title: "Custom/Primitives/WelcomeBackLoading",
  component: WelcomeBackLoading,
  decorators: [withSize({ height: "480px" })],
}

export default meta
type Story = StoryObj<typeof WelcomeBackLoading>

const stageMap = (
  embed: [number, number],
  classify: [number, number],
  regions: [number, number]
): StageCounterMap => ({
  embed: { settled: embed[0], total: embed[1] },
  classify: { settled: classify[0], total: classify[1] },
  regions: { settled: regions[0], total: regions[1] },
})

const ROW_LABELS = [
  "Understanding your content...",
  "Classifying documents...",
  "Finding regions...",
]

const assertStageRows = (canvasElement: HTMLElement, stages: StageCounterMap) => {
  const rowTexts = ROW_LABELS.map((label) => {
    const labelSpan = [...canvasElement.querySelectorAll("span")].find(
      (span) => span.textContent === label
    )
    if (!labelSpan) throw new globalThis.Error(`no stage row renders "${label}"`)
    return labelSpan.parentElement?.textContent ?? ""
  })

  const counters = [stages.embed, stages.classify, stages.regions]
  rowTexts.forEach((text, i) => {
    expect(text).toContain(`${counters[i].settled}/${counters[i].total}`)
  })
}

const stageStory = (progress: number, statusLabel: string, stages: StageCounterMap): Story => ({
  args: { progress, statusLabel, stages },
  play: async ({ canvasElement }) => {
    assertStageRows(canvasElement, stages)
  },
})

export const MidProgress: Story = {
  args: { progress: 60, statusLabel: "Loading documents..." },
  play: async ({ canvas }) => {
    expect(canvas.getByText("Loading documents...")).toBeInTheDocument()
    for (const label of ROW_LABELS) {
      expect(canvas.queryByText(label)).toBeNull()
    }
  },
}

export const StagesEmpty: Story = stageStory(70, "", stageMap([0, 0], [0, 0], [0, 0]))

export const StagesMidFlight: Story = stageStory(85, "", stageMap([9, 14], [4, 14], [11, 12]))

export const StagesComplete: Story = {
  ...stageStory(100, "Finalizing...", stageMap([14, 14], [14, 14], [12, 12])),
  play: async ({ canvas, canvasElement }) => {
    assertStageRows(canvasElement, stageMap([14, 14], [14, 14], [12, 12]))
    expect(canvas.getByText("Finalizing...")).toBeInTheDocument()
  },
}

// A row whose settled count includes a failed file renders as plain progress,
// never as an error state.
export const StagesOneFailed: Story = stageStory(92, "", stageMap([14, 14], [8, 14], [10, 12]))
