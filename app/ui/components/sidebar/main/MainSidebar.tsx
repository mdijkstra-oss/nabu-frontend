"use client"

import type { ReactNode } from "react"
import { LogOut, Settings, User } from "lucide-react"
import * as SubframeCore from "@subframe/core"
import { AnimatePresence, motion } from "framer-motion"
import { Avatar } from "~/ui/components/Avatar"
import { DropdownMenu } from "~/ui/components/DropdownMenu"
import { SidebarRailWithLabels } from "~/ui/components/SidebarRailWithLabels"
import { usePointedAt } from "~/lib/ui/pointing"
import { cn } from "~/ui/utils"

export interface NavItem {
  id: string
  icon: ReactNode
  label: string
  selected?: boolean
  disabled?: boolean
  badge?: number
  badgeColor?: string
  pointId?: string
}

interface UserMenuAction {
  id: string
  icon: ReactNode
  label: string
}

interface MainSidebarProps {
  logoSrc?: string
  navItemGroups: NavItem[][]
  userAvatarSrc?: string
  userInitials?: string
  userMenuActions?: UserMenuAction[]
  footerExtra?: ReactNode
  onNavItemClick?: (id: string) => void
  onNavItemHover?: (id: string) => void
  onUserMenuAction?: (actionId: string) => void
}

const defaultUserMenuActions: UserMenuAction[] = [
  { id: "account", icon: <User />, label: "Account" },
  { id: "settings", icon: <Settings />, label: "Settings" },
  { id: "logout", icon: <LogOut />, label: "Log out" },
]

interface NavItemRowProps {
  item: NavItem
  onClick?: () => void
  onMouseEnter?: () => void
}

const NavItemRow = ({ item, onClick, onMouseEnter }: NavItemRowProps) => {
  const pointed = usePointedAt(item.pointId)
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
    >
      <SidebarRailWithLabels.NavItem
        icon={item.icon}
        selected={item.selected}
        pointed={pointed}
        badge={item.badge}
        badgeColor={item.badgeColor}
        className={cn(item.disabled && "opacity-40 pointer-events-none")}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
      >
        {item.label}
      </SidebarRailWithLabels.NavItem>
    </motion.div>
  )
}

export function MainSidebar({
  logoSrc = "https://res.cloudinary.com/subframe/image/upload/v1711417507/shared/y2rsnhq3mex4auk54aye.png",
  navItemGroups,
  userAvatarSrc = "/avatar.png",
  userInitials = "A",
  userMenuActions = defaultUserMenuActions,
  footerExtra,
  onNavItemClick,
  onNavItemHover,
  onUserMenuAction,
}: MainSidebarProps) {
  const handleNavItemClick = (id: string) => () => onNavItemClick?.(id)
  const handleNavItemHover = (id: string) => () => onNavItemHover?.(id)
  const handleUserMenuAction = (actionId: string) => () => onUserMenuAction?.(actionId)

  const renderNavContent = () =>
    navItemGroups.flatMap((group, groupIndex) => {
      const items = group.map((item) => (
        <NavItemRow
          key={item.id}
          item={item}
          onClick={item.disabled ? undefined : handleNavItemClick(item.id)}
          onMouseEnter={item.disabled ? undefined : handleNavItemHover(item.id)}
        />
      ))
      const isLastGroup = groupIndex === navItemGroups.length - 1
      if (isLastGroup) return items
      return [
        ...items,
        <div
          key={`divider-${groupIndex}`}
          className="flex h-px w-full flex-none flex-col items-center gap-2 bg-neutral-border"
        />,
      ]
    })

  return (
    <SidebarRailWithLabels
      header={
        <div className="flex flex-col items-center justify-center gap-2 px-1 py-1">
          <img className="h-6 w-6 flex-none object-cover" src={logoSrc} alt="Logo" />
        </div>
      }
      footer={
        <div className="flex flex-col items-center justify-end gap-3 px-2 py-2">
          {footerExtra}
          <SubframeCore.DropdownMenu.Root>
            <SubframeCore.DropdownMenu.Trigger asChild={true}>
              <Avatar image={userAvatarSrc}>{userInitials}</Avatar>
            </SubframeCore.DropdownMenu.Trigger>
            <SubframeCore.DropdownMenu.Portal>
              <SubframeCore.DropdownMenu.Content
                side="right"
                align="end"
                sideOffset={4}
                asChild={true}
              >
                <DropdownMenu>
                  {userMenuActions.map((action) => (
                    <DropdownMenu.DropdownItem
                      key={action.id}
                      icon={action.icon}
                      onClick={handleUserMenuAction(action.id)}
                    >
                      {action.label}
                    </DropdownMenu.DropdownItem>
                  ))}
                </DropdownMenu>
              </SubframeCore.DropdownMenu.Content>
            </SubframeCore.DropdownMenu.Portal>
          </SubframeCore.DropdownMenu.Root>
        </div>
      }
    >
      <AnimatePresence initial={false}>{renderNavContent()}</AnimatePresence>
    </SidebarRailWithLabels>
  )
}
