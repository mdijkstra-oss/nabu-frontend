"use client"

import type { Components } from "react-markdown"
import { createElement } from "react"
import { FileText, MapPin, Search } from "lucide-react"
import {
  findDepFile,
  resolveEntityLink,
  type EntityIcons,
  type ResolvedLink,
} from "~/lib/markdown/resolve"
import type { FileStore } from "~/lib/files/store"
import { createCappedCache } from "~/lib/utils/cache"
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

const linkCache = createCappedCache<string, ResolvedLink | null>(2000)

const buildCacheKey = (href: string, content: string): string => `${href}\x00${content}`

const getCachedResolution = (
  href: string,
  files: FileStore,
  projectId: string
): ResolvedLink | null => {
  const depFile = findDepFile(href, files)
  if (!depFile) return resolveEntityLink(href, files, projectId, entityIcons)
  const content = files[depFile]
  if (content === undefined) return null
  const key = buildCacheKey(href, content)
  const cached = linkCache.get(key)
  if (cached !== undefined) return cached
  const resolved = resolveEntityLink(href, files, projectId, entityIcons)
  linkCache.set(key, resolved)
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
        children: resolved.label,
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
