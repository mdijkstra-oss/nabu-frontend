import type { Meta, StoryObj } from "@storybook/react-vite"
import { FileText, MessageSquare, Search } from "lucide-react"
import { withSize } from "../../../.storybook/decorators"
import { Tabs } from "./Tabs"

const meta: Meta<typeof Tabs> = {
  title: "Custom/Primitives/Tabs",
  component: Tabs,
  decorators: [withSize({ width: "420px" })],
}

export default meta
type Story = StoryObj<typeof Tabs>

export const ItemStates: Story = {
  render: () => (
    <Tabs>
      <Tabs.Item active>Documents</Tabs.Item>
      <Tabs.Item>Search</Tabs.Item>
      <Tabs.Item disabled>Archive</Tabs.Item>
    </Tabs>
  ),
}

export const WithIcons: Story = {
  render: () => (
    <Tabs>
      <Tabs.Item active icon={<FileText />}>
        Documents
      </Tabs.Item>
      <Tabs.Item icon={<Search />}>Search</Tabs.Item>
      <Tabs.Item icon={<MessageSquare />}>Chat</Tabs.Item>
    </Tabs>
  ),
}
