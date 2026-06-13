import type { FileStore } from "./store"
import { findAnnotationById } from "~/domain/data-blocks/attributes/annotations/selectors"
import { findCalloutById } from "~/domain/data-blocks/callout/selectors"
import { findTagDefinitionById, getTagDisplay } from "~/domain/data-blocks/settings/tags/selectors"
import { findSearchById } from "~/domain/data-blocks/settings/searches/selectors"
import { toDisplayName } from "./filename"
import { resolveIdentifiers } from "~/lib/markdown/linkify/entities"

const resolveTagName = (files: FileStore, id: string): string | null => {
  const def = findTagDefinitionById(files, id)
  return def ? getTagDisplay(def) : null
}

export const resolveEntityName = (files: FileStore, id: string): string | null =>
  id.startsWith("annotation-")
    ? (findAnnotationById(files, id)?.text ?? null)
    : id.startsWith("callout-")
      ? (findCalloutById(files, id)?.title ?? null)
      : id.startsWith("search-")
        ? (findSearchById(files, id)?.description ?? null)
        : id.startsWith("tag-")
          ? resolveTagName(files, id)
          : id.endsWith(".md") && id.toLowerCase() in files
            ? toDisplayName(id.toLowerCase())
            : null

export const buildIdentifierResolver = (files: FileStore): ((text: string) => string) => {
  const resolveName = (id: string): string | null => resolveEntityName(files, id)
  return (text: string) => resolveIdentifiers(text, resolveName)
}
