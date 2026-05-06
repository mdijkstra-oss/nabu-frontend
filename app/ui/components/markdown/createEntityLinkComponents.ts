"use client"

import type { Components } from "react-markdown"
import { createElement } from "react"
import { FileText, MapPin, Search } from "lucide-react"
import { resolveEntityLink, type EntityIcons, type ResolvedLink } from "~/lib/markdown/resolve"
import type { FileStore } from "~/lib/files/store"
import { EntityLink } from "./EntityLink"

interface EntityLinkContext {
  files: FileStore
  projectId: string | null
  navigate?: (url: string) => void
}

const entityIcons: EntityIcons = {
  file: FileText,
  spotlight: MapPin,
  search: Search,
}

let cachedFiles: FileStore | null = null
let linkCache = new Map<string, ResolvedLink | null>()

const getCachedResolution = (
  href: string,
  files: FileStore,
  projectId: string
): ResolvedLink | null => {
  if (files !== cachedFiles) {
    cachedFiles = files
    linkCache = new Map()
  }
  const cached = linkCache.get(href)
  if (cached !== undefined) return cached
  const resolved = resolveEntityLink(href, files, projectId, entityIcons)
  linkCache.set(href, resolved)
  return resolved
}

const createAnchorComponent =
  ({ files, projectId, navigate }: EntityLinkContext): Components["a"] =>
  (props) => {
    const href = props.href as string | undefined
    if (!href) return createElement("a", props)

    const resolved = projectId ? getCachedResolution(href, files, projectId) : null

    if (resolved) {
      const handleClick = navigate
        ? (e: React.MouseEvent) => {
            e.preventDefault()
            navigate(resolved.url)
          }
        : undefined

      return createElement(EntityLink, {
        href: resolved.url,
        colors: resolved.colors,
        icon: resolved.icon,
        onClick: handleClick,
        children: props.children,
      })
    }

    const isExternal = href.startsWith("http://") || href.startsWith("https://")
    return createElement("a", {
      ...props,
      href,
      target: isExternal ? "_blank" : undefined,
      rel: isExternal ? "noopener noreferrer" : undefined,
      className: "text-brand-600 hover:underline",
    })
  }

export const createEntityLinkComponents = (ctx: EntityLinkContext): Partial<Components> => ({
  a: createAnchorComponent(ctx),
})
