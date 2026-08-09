import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"
import { Bot, FileText, MessageSquare, Search, Settings } from "lucide-react"
import { withSize } from "../../../.storybook/decorators"
import { SidebarRailWithLabels } from "./SidebarRailWithLabels"

const meta: Meta<typeof SidebarRailWithLabels> = {
  title: "Custom/Primitives/SidebarRailWithLabels",
  component: SidebarRailWithLabels,
  decorators: [withSize({ height: "480px" })],
}

export default meta
type Story = StoryObj<typeof SidebarRailWithLabels>

export const Rail: Story = {
  render: () => (
    <SidebarRailWithLabels
      header={<Bot className="h-6 w-6 text-brand-600" />}
      footer={
        <SidebarRailWithLabels.NavItem icon={<Settings />}>Settings</SidebarRailWithLabels.NavItem>
      }
    >
      <SidebarRailWithLabels.NavItem icon={<FileText />} selected>
        Documents
      </SidebarRailWithLabels.NavItem>
      <SidebarRailWithLabels.NavItem icon={<Search />}>Search</SidebarRailWithLabels.NavItem>
      <SidebarRailWithLabels.NavItem icon={<MessageSquare />}>Chat</SidebarRailWithLabels.NavItem>
    </SidebarRailWithLabels>
  ),
}

const navItemFrame = withSize({ width: "96px" })

export const NavItemDefault: Story = {
  decorators: [navItemFrame],
  render: () => (
    <SidebarRailWithLabels.NavItem icon={<FileText />}>Documents</SidebarRailWithLabels.NavItem>
  ),
}

export const NavItemSelected: Story = {
  decorators: [navItemFrame],
  render: () => (
    <SidebarRailWithLabels.NavItem icon={<FileText />} selected>
      Documents
    </SidebarRailWithLabels.NavItem>
  ),
}

export const NavItemPointed: Story = {
  decorators: [navItemFrame],
  render: () => (
    <SidebarRailWithLabels.NavItem icon={<FileText />} pointed>
      Documents
    </SidebarRailWithLabels.NavItem>
  ),
}

export const NavItemWithCountBadge: Story = {
  decorators: [navItemFrame],
  render: () => (
    <SidebarRailWithLabels.NavItem
      icon={<MessageSquare />}
      badge={7}
      badgeColor="var(--color-brand-600)"
    >
      Chat
    </SidebarRailWithLabels.NavItem>
  ),
}

export const NavItemBadgeOver99: Story = {
  decorators: [navItemFrame],
  render: () => (
    <SidebarRailWithLabels.NavItem icon={<MessageSquare />} badge={120}>
      Chat
    </SidebarRailWithLabels.NavItem>
  ),
  play: async ({ canvas }) => {
    expect(canvas.getByText("99+")).toBeInTheDocument()
  },
}
