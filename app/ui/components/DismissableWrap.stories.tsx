import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import { DismissableWrap } from "./DismissableWrap"

const containerClick = fn()

const meta: Meta<typeof DismissableWrap> = {
  title: "Custom/Primitives/DismissableWrap",
  component: DismissableWrap,
  args: {
    onDismiss: fn(),
    children: <span className="text-body font-body">Filter: interviews</span>,
  },
}

export default meta
type Story = StoryObj<typeof DismissableWrap>

export const DismissStopsPropagation: Story = {
  render: (args) => (
    <div onClick={containerClick}>
      <DismissableWrap {...args} />
    </div>
  ),
  play: async ({ args, canvas }) => {
    containerClick.mockClear()
    await userEvent.click(canvas.getByRole("button"))
    expect(args.onDismiss).toHaveBeenCalledOnce()
    expect(containerClick).not.toHaveBeenCalled()
  },
}
