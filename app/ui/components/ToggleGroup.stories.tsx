import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import { LayoutGrid, List, Table } from "lucide-react"
import { ToggleGroup } from "./ToggleGroup"

const meta: Meta<typeof ToggleGroup> = {
  title: "Custom/Primitives/ToggleGroup",
  component: ToggleGroup,
  args: { onValueChange: fn() },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroup.Item value="list" icon={<List />}>
        List
      </ToggleGroup.Item>
      <ToggleGroup.Item value="grid" icon={<LayoutGrid />}>
        Grid
      </ToggleGroup.Item>
      <ToggleGroup.Item value="table" icon={<Table />}>
        Table
      </ToggleGroup.Item>
    </ToggleGroup>
  ),
}

export default meta
type Story = StoryObj<typeof ToggleGroup>

export const FirstSelected: Story = {
  args: { value: "list" },
}

export const SecondSelected: Story = {
  args: { value: "grid" },
}

export const ThirdSelected: Story = {
  args: { value: "table" },
}

export const WithDisabledItem: Story = {
  args: { value: "list" },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroup.Item value="list" icon={<List />}>
        List
      </ToggleGroup.Item>
      <ToggleGroup.Item value="grid" icon={<LayoutGrid />} disabled>
        Grid
      </ToggleGroup.Item>
    </ToggleGroup>
  ),
}

export const ClickFiresOnValueChange: Story = {
  args: { value: "list" },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Grid"))
    expect(args.onValueChange).toHaveBeenCalledWith("grid")
  },
}
