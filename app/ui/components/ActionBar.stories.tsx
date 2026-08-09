import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn } from "storybook/test"
import { Pencil, Sparkles, Trash2 } from "lucide-react"
import { ActionBar, type ActionBarAction } from "./FloatingActionBar"

const actions: ActionBarAction[] = [
  { icon: <Sparkles />, label: "Ask Nabu", onClick: fn(), variant: "ai" },
  { icon: <Pencil />, label: "Rename", onClick: fn() },
  { icon: <Trash2 />, label: "Clear codings", onClick: fn(), variant: "confirm" },
]

const detail = (
  <>
    <span>Theme: coping strategies</span>
    <span>Theme: social support</span>
    <span>Code: reframing</span>
    <span>Code: avoidance</span>
  </>
)

const meta: Meta<typeof ActionBar> = {
  title: "Custom/Primitives/ActionBar",
  component: ActionBar,
  decorators: [
    (Story) => (
      <div style={{ width: 560, paddingTop: 160 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ActionBar>

export const UngatedWithConfirmDetailAndTitleAction: Story = {
  args: {
    title: "3 codes selected",
    detail,
    titleAction: { label: "rename", onClick: fn() },
    actions,
  },
  play: async ({ canvas }) => {
    expect(canvas.getByRole("button", { name: "Ask Nabu" })).toBeInTheDocument()
    expect(canvas.getByRole("button", { name: "Rename" })).toBeInTheDocument()
    expect(canvas.getByRole("button", { name: "Clear codings" })).toBeInTheDocument()
  },
}
