import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, type within } from "storybook/test"
import { SearchBarView } from "./SearchBarView"
import { stackHits, corpusHits, recentSearches, savedSearches } from "./fixtures"

const meta: Meta<typeof SearchBarView> = {
  title: "Custom/Search/SearchBarView",
  component: SearchBarView,
  decorators: [
    (Story) => (
      <div style={{ width: 560, minHeight: 480 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    query: "",
    onQueryChange: fn(),
    stackHits: [],
    corpusHits: [],
    recentSearches: [],
    savedSearches: [],
    onSelectSearch: fn(),
    onToggleSave: fn(),
    onPickInStack: fn(),
    onPickCorpus: fn(),
    onRunAi: fn(),
  },
}

export default meta
type Story = StoryObj<typeof SearchBarView>

const openDropdown = (canvas: ReturnType<typeof within>) =>
  userEvent.click(canvas.getByPlaceholderText("Search documents, people, places, quotes…"))

export const FixtureHits: Story = {
  args: {
    query: "river",
    stackHits,
  },
  play: async ({ canvas }) => {
    await openDropdown(canvas)
    await expect(canvas.getByText("In this stack")).toBeInTheDocument()
    await expect(canvas.getByText("Field Notes")).toBeInTheDocument()
    await expect(canvas.getByText("Interview Maria")).toBeInTheDocument()
  },
}

export const EmptyStack: Story = {
  args: {
    query: "glacier",
  },
  play: async ({ canvas }) => {
    await openDropdown(canvas)
    await expect(canvas.getByText("No matches in this stack.")).toBeInTheDocument()
    expect(canvas.queryByText(/more across the corpus/)).toBeNull()
  },
}

export const CorpusReveal: Story = {
  args: {
    query: "river",
    stackHits,
    corpusHits,
  },
  play: async ({ canvas, canvasElement }) => {
    await openDropdown(canvas)
    await userEvent.click(canvas.getByText("Show 2 more across the corpus"))
    await expect(canvas.getByText("Archive Letters")).toBeInTheDocument()
    await expect(canvas.getByText("Press Clippings")).toBeInTheDocument()
    expect(canvasElement.querySelector(".lucide-arrow-up-right")).not.toBeNull()
  },
}

export const Idle: Story = {
  args: {
    recentSearches,
    savedSearches,
  },
  play: async ({ args, canvas }) => {
    await openDropdown(canvas)
    await expect(canvas.getByText("Recent searches")).toBeInTheDocument()
    await expect(canvas.getByText("River flooding accounts")).toBeInTheDocument()
    await expect(canvas.getByText("Saved searches")).toBeInTheDocument()
    await expect(canvas.getByText("Ford crossings")).toBeInTheDocument()

    await userEvent.click(canvas.getAllByRole("button", { name: "Save search" })[0])
    expect(args.onToggleSave).toHaveBeenCalledWith("s1")
    expect(args.onSelectSearch).not.toHaveBeenCalled()
  },
}
