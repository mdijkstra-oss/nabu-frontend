import { getKind, type KindDescriptor } from "./registry"

export type TitlePart = { type: "text"; text: string } | { type: "kind"; kind: KindDescriptor }

const TAG = /:([a-z]+):/g

// A `:speaker:` tag in a stored title stands for that kind's icon; splitting keeps
// the JSON free of markup while renderers decide how to draw the kind.
export const splitKindTags = (title: string): TitlePart[] => {
  const parts: TitlePart[] = []
  let last = 0
  for (const match of title.matchAll(TAG)) {
    const kind = getKind(match[1])
    if (!kind) continue
    if (match.index > last) parts.push({ type: "text", text: title.slice(last, match.index) })
    parts.push({ type: "kind", kind })
    last = match.index + match[0].length
  }
  if (last < title.length) parts.push({ type: "text", text: title.slice(last) })
  return parts
}

export const stripKindTags = (title: string): string =>
  splitKindTags(title)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .replace(/\s+/g, " ")
    .trim()

export const kindTitle = (kindId: string, label: string): string => `:${kindId}: ${label}`
