import { Component, type ReactNode } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, waitFor } from "storybook/test"
import { withSize } from "../../../../.storybook/decorators"
import { ChatTimeline, SegmentRenderer, stepIconColor, stepMarker } from "./ChatTimeline"
import { railClass } from "./TimelineCard"
import type { ChatEntityContext } from "./MessageContent"
import type { FinalSegment } from "./collapse"
import {
  segmentFixtures,
  userLeaf,
  assistantLeaf,
  draftLeaf,
  draftLeafEmpty,
  unansweredAsk,
  answeredAsk,
  typedAnswerAsk,
  planStepMatrix,
  stepStackFive,
  CHAT_SIDEBAR_WIDTH,
} from "./fixtures"

const context: ChatEntityContext = {
  files: { "interviews.md": "# Interviews" },
  projectId: "p1",
  currentFile: null,
  currentFileContent: null,
  navigate: fn(),
}

const segmentProps = {
  context,
  onSelect: fn(),
  onSelectFile: fn(),
  onContinue: fn(),
  isLast: false,
}

const meta: Meta<typeof ChatTimeline> = {
  title: "Custom/Chat/ChatTimeline",
  component: ChatTimeline,
  decorators: [withSize({ width: CHAT_SIDEBAR_WIDTH })],
  args: {
    segments: [],
    context,
    onSelect: fn(),
    onSelectFile: fn(),
    onContinue: fn(),
    spinnerLabels: null,
    showAbortBox: false,
    showPlaceholder: false,
  },
}

export default meta
type Story = StoryObj<typeof ChatTimeline>

export const TwoLeafConversation: Story = {
  render: () => (
    <>
      <SegmentRenderer {...segmentProps} segment={userLeaf} />
      <SegmentRenderer {...segmentProps} segment={assistantLeaf} />
    </>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("How do the interviews describe onboarding?")).toBeVisible()
    await expect(canvas.getByText("rushed")).toBeVisible()
    await expect(canvas.getByText(/in most interviews/)).toBeVisible()
  },
}

export const AllVariants: Story = {
  args: {
    segments: Object.values(segmentFixtures).flat(),
  },
  play: async ({ canvas }) => {
    await waitFor(() => {
      expect(canvas.getByText("How do the interviews describe onboarding?")).toBeVisible()
      expect(canvas.getAllByText("Which section should I analyze first?")).toHaveLength(3)
      expect(canvas.getByText("Analyze onboarding themes across all interviews")).toBeVisible()
      expect(canvas.getByText("5 upcoming steps")).toBeVisible()
      expect(canvas.getByText("Continue to next step")).toBeVisible()
      expect(canvas.getByText(/3 changes across 3 files/)).toBeVisible()
    })
  },
}

export const EmptyPlaceholder: Story = {
  args: {
    showPlaceholder: true,
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("How can I help you today?")).toBeVisible()
    expect(canvasElement.querySelector('span[class*="w-[3px]"]')).toBeNull()
  },
}

export const SingleLabelSpinner: Story = {
  args: {
    spinnerLabels: ["Searching documents"],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Searching documents")).toBeVisible()
  },
}

export const StreamingDraft: Story = {
  render: () => <SegmentRenderer {...segmentProps} segment={draftLeaf} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Here is what I found so far")).toBeVisible()
    expect(canvas.queryByText(/const partial/)).toBeNull()
  },
}

export const EmptyDraft: Story = {
  render: () => (
    <div data-testid="empty-draft">
      <SegmentRenderer {...segmentProps} segment={draftLeafEmpty} />
    </div>
  ),
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("empty-draft")
    expect(container.childElementCount).toBe(0)
    expect(container.textContent).toBe("")
  },
}

export const UnansweredAsk: Story = {
  args: {
    segments: [{ key: "ask", segment: unansweredAsk }],
  },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /The onboarding chapter/ }))
    expect(args.onSelect).toHaveBeenCalledTimes(1)
    expect(args.onSelect).toHaveBeenCalledWith("The onboarding chapter")
  },
}

export const AnsweredAsk: Story = {
  args: {
    segments: [{ key: "ask", segment: answeredAsk }],
  },
  play: async ({ canvas }) => {
    const selected = canvas.getByText("The onboarding chapter")
    await waitFor(() => expect(selected).toBeVisible())
    expect(selected.closest("button")).toBeNull()
    expect(selected.closest('[class*="border-brand-600"]')).not.toBeNull()

    const dimmed = canvas.getByRole("button", { name: /The exit interviews/ })
    expect(dimmed).toBeDisabled()
    expect(dimmed.className).toContain("opacity-50")
  },
}

export const TypedAnswerAsk: Story = {
  args: {
    segments: [{ key: "ask", segment: typedAnswerAsk }],
  },
  play: async ({ canvas }) => {
    await waitFor(() => {
      expect(canvas.getByText("ANSWER")).toBeVisible()
      expect(canvas.getByText("Start with the recruitment notes instead")).toBeVisible()
    })
  },
}

export const PlanStepMatrix: Story = {
  render: () => (
    <>
      {planStepMatrix.map((step) => (
        <div key={step.description} data-testid={step.description}>
          <SegmentRenderer {...segmentProps} segment={step} />
        </div>
      ))}
    </>
  ),
  play: async ({ canvas }) => {
    for (const step of planStepMatrix) {
      const card = canvas.getByTestId(step.description)
      const rail = card.querySelector('span[class*="w-[3px]"]')
      const expectedRail = step.checkpoint ? "bg-brand-700" : railClass[stepMarker[step.status]]
      expect(rail?.className).toContain(expectedRail)

      const bubble = card.querySelector("svg.lucide-message-square")
      if (step.checkpoint) expect(bubble).not.toBeNull()
      else expect(bubble).toBeNull()

      const icon = card.querySelector("svg")
      expect(icon?.getAttribute("class")).toContain(stepIconColor[step.status])

      const indented = card.querySelector(".pl-4")
      if (step.nested) expect(indented).not.toBeNull()
      else expect(indented).toBeNull()
    }
  },
}

export const StepStack: Story = {
  render: () => <SegmentRenderer {...segmentProps} segment={stepStackFive} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByText("5 upcoming steps"))
    for (const step of stepStackFive.steps) {
      const row = await canvas.findByText(step.description)
      await waitFor(() => expect(row).toBeVisible())
      const rowContainer = row.closest("div")
      if (step.nested) expect(rowContainer?.className).toContain("pl-6")
      else expect(rowContainer?.className).not.toContain("pl-6")
    }
  },
}

export const ContinuePrompt: Story = {
  args: {
    segments: [{ key: "continue-prompt", segment: { type: "continue-prompt" } }],
  },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Continue to next step/ }))
    expect(args.onContinue).toHaveBeenCalledTimes(1)
  },
}

export const AbortedPlan: Story = {
  args: {
    showAbortBox: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Pivoted plan")).toBeVisible()
  },
}

interface CatchBoundaryState {
  error: Error | null
}

class CatchBoundary extends Component<{ children: ReactNode }, CatchBoundaryState> {
  state: CatchBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): CatchBoundaryState {
    return { error }
  }

  render() {
    if (this.state.error) return <p>caught: {this.state.error.message}</p>
    return this.props.children
  }
}

export const UnlistedSegmentThrows: Story = {
  render: () => (
    <CatchBoundary>
      <SegmentRenderer {...segmentProps} segment={{ type: "tick" } as unknown as FinalSegment} />
    </CatchBoundary>
  ),
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByText(/caught: unhandled/)).toBeVisible())
  },
}
