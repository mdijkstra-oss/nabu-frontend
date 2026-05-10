"use client"

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type MutableRefObject,
  type MouseEvent,
} from "react"
import { AnimatePresence, motion } from "framer-motion"
import { BarChart3, Book, Files, Search } from "lucide-react"
import { MainSidebar } from "~/ui/components/sidebar/main/MainSidebar"
import type { NavItem } from "~/ui/components/sidebar/main/MainSidebar"
import { useResizable } from "~/ui/hooks/useResizable"
import { cn } from "~/ui/utils"

type ActiveNav = "documents" | "search" | "exhibits" | "codes"

interface DefaultPageLayoutProps {
  children?: ReactNode
  rightPanel?: ReactNode
  sidebarPanels?: Partial<Record<ActiveNav, ReactNode>>
  sidebarFooterExtra?: ReactNode
  className?: string
  activeNav?: ActiveNav
  showCodes?: boolean
  showExhibits?: boolean
  annotationCount?: number
  onNavChange?: (nav: ActiveNav) => void
  dismissSidebarRef?: MutableRefObject<(() => void) | null>
}

const BADGE_COLOR_ACTIVE = "var(--color-badge-active)"
const BADGE_COLOR_EMPTY = "var(--color-neutral-400)"

const buildNavItems = (
  hoveredNav: ActiveNav | null,
  showCodes: boolean,
  showExhibits: boolean,
  annotationCount?: number
): NavItem[][] => {
  const items: NavItem[] = [
    {
      id: "documents",
      icon: <Files />,
      label: "Documents",
      selected: hoveredNav === "documents",
    },
    ...(showExhibits
      ? [
          {
            id: "exhibits",
            icon: <BarChart3 />,
            label: "Exhibits",
            selected: hoveredNav === "exhibits",
          },
        ]
      : []),
    ...(showCodes
      ? [
          {
            id: "codes",
            icon: <Book />,
            label: "Codes",
            selected: hoveredNav === "codes",
            badge: annotationCount,
            badgeColor: annotationCount ? BADGE_COLOR_ACTIVE : BADGE_COLOR_EMPTY,
          },
        ]
      : []),
    {
      id: "search",
      icon: <Search />,
      label: "Search",
      selected: hoveredNav === "search",
    },
  ]

  return [items]
}

const HANDLE_WIDTH = 12
const CONTAINER_PADDING = 24
const MIN_LEFT_WIDTH = 400
const MIN_RIGHT_WIDTH = 280
const RIGHT_PANEL_DEFAULT = { width: 320, height: 0 }
const RIGHT_PANEL_STORAGE_KEY = "layout:right-panel"

const computeMaxRightWidth = (containerWidth: number): number =>
  Math.floor((containerWidth - CONTAINER_PADDING - HANDLE_WIDTH) / 2)

export const DefaultPageLayout = ({
  children,
  rightPanel,
  sidebarPanels,
  sidebarFooterExtra,
  className,
  activeNav: _activeNav = "documents",
  showCodes = false,
  showExhibits = false,
  annotationCount,
  onNavChange,
  dismissSidebarRef,
}: DefaultPageLayoutProps) => {
  const [hoveredNav, setHoveredNav] = useState<ActiveNav | null>(null)
  useEffect(() => {
    if (dismissSidebarRef) dismissSidebarRef.current = () => setHoveredNav(null)
  })
  const activePanel = hoveredNav && sidebarPanels?.[hoveredNav]

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(([entry]) =>
      setContainerWidth(entry.contentRect.width + CONTAINER_PADDING)
    )
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const maxRightWidth = computeMaxRightWidth(containerWidth || 800)

  const { size: rightPanelSize, handleResizeMouseDown } = useResizable(RIGHT_PANEL_DEFAULT, {
    bounds: { minWidth: MIN_RIGHT_WIDTH, maxWidth: maxRightWidth, minHeight: 0, maxHeight: 0 },
    storageKey: RIGHT_PANEL_STORAGE_KEY,
  })

  const rightWidth = Math.min(rightPanelSize.width, maxRightWidth)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!isDragging) return
    const prev = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    return () => {
      document.body.style.cursor = prev.cursor
      document.body.style.userSelect = prev.userSelect
    }
  }, [isDragging])

  const onDragStart = useCallback(
    (e: MouseEvent) => {
      setIsDragging(true)
      handleResizeMouseDown(e)
      const onUp = () => {
        setIsDragging(false)
        document.removeEventListener("mouseup", onUp)
      }
      document.addEventListener("mouseup", onUp)
    },
    [handleResizeMouseDown]
  )

  return (
    <div className={cn("flex h-screen w-full items-center", className)}>
      <div className="relative z-50 flex h-full flex-none" onMouseLeave={() => setHoveredNav(null)}>
        <div className="relative z-30">
          <MainSidebar
            navItemGroups={buildNavItems(hoveredNav, showCodes, showExhibits, annotationCount)}
            footerExtra={sidebarFooterExtra}
            onNavItemClick={onNavChange ? (id) => onNavChange(id as ActiveNav) : undefined}
            onNavItemHover={(id) => setHoveredNav(id as ActiveNav)}
          />
        </div>
        <AnimatePresence>
          {activePanel && (
            <motion.div
              key={hoveredNav}
              initial={{ x: -12, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -12, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
              className="absolute left-full top-0 h-full z-20 shadow-xl"
            >
              {activePanel}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div ref={containerRef} className="flex h-full grow overflow-hidden bg-neutral-100 p-3">
        {children && (
          <div
            className="relative flex grow flex-col items-start gap-4 rounded-xl bg-default-background overflow-hidden"
            style={{ minWidth: MIN_LEFT_WIDTH }}
          >
            {children}
          </div>
        )}
        {rightPanel && (
          <>
            <div
              className="flex-none cursor-col-resize flex items-center justify-center group"
              style={{ width: HANDLE_WIDTH }}
              onMouseDown={onDragStart}
            >
              <div
                className={cn(
                  "w-px h-full bg-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity",
                  isDragging && "!opacity-100"
                )}
              />
            </div>
            <div
              className="flex flex-col flex-none h-full pt-2 pr-2 pb-2"
              style={{ width: rightWidth }}
            >
              {rightPanel}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export type { ActiveNav }
