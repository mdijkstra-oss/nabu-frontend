import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import { SearchRow } from "./SearchBarView"
import { recentSearches, savedSearches } from "./fixtures"

const meta: Meta<typeof SearchRow> = {
  title: "Custom/Search/SearchRow",
  component: SearchRow,
  decorators: [
    (Story) => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onSelect: fn(),
    onToggleSave: fn(),
  },
}

export default meta
type Story = StoryObj<typeof SearchRow>

export const Recent: Story = {
  args: {
    entry: recentSearches[0],
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save search" }))
    expect(args.onToggleSave).toHaveBeenCalledOnce()
    expect(args.onSelect).not.toHaveBeenCalled()

    await userEvent.click(canvas.getByText("River flooding accounts"))
    expect(args.onSelect).toHaveBeenCalledOnce()
  },
}

export const Saved: Story = {
  args: {
    entry: savedSearches[0],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Remove from saved" })).toBeInTheDocument()
  },
}
