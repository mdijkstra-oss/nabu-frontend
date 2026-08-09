import type { Meta, StoryObj } from "@storybook/react-vite"
import { AlertCircle, Search } from "lucide-react"
import { withSize } from "../../../.storybook/decorators"
import { TextField } from "./TextField"

const meta: Meta<typeof TextField> = {
  title: "Custom/Primitives/TextField",
  component: TextField,
  decorators: [withSize({ width: "280px" })],
  render: (args) => (
    <TextField {...args}>
      <TextField.Input placeholder="Search documents" />
    </TextField>
  ),
}

export default meta
type Story = StoryObj<typeof TextField>

export const Outline: Story = {
  args: { variant: "outline" },
}

export const Filled: Story = {
  args: { variant: "filled" },
}

export const Error: Story = {
  args: { error: true, helpText: "Something went wrong", iconRight: <AlertCircle /> },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const WithLabelAndHelpText: Story = {
  args: { label: "Project name", helpText: "Shown in the sidebar" },
}

export const WithIcons: Story = {
  args: { icon: <Search />, iconRight: <AlertCircle /> },
}
