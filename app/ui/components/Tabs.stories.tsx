import type { Meta, StoryObj } from "@storybook/react-vite"
import { FileText, MessageSquare, Search } from "lucide-react"
import { Tabs } from "./Tabs"

const meta: Meta<typeof Tabs> = {
  title: "Custom/Primitives/Tabs",
  component: Tabs,
  decorators: [
    (Story) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    ),
  ],
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
