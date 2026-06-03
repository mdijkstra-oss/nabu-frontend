import type { CalloutBlock } from "../schema"
import { getCallouts } from "../selectors"
import { toDisplayName } from "~/lib/files/filename"
import type { FileStore } from "~/lib/files/store"
import { createFileStoreSelector, findIn } from "~/lib/files/collect"
import { getSelectedCodes } from "~/domain/data-blocks/ux/selectors"

export interface Code {
  id: string
  name: string
  color: string
  detail: string
}

export interface CodeGroup {
  fileId: string
  name: string
  codes: Code[]
}

export interface Codebook {
  categories: CodeGroup[]
}

export const getCodes = (raw: string): CalloutBlock[] =>
  getCallouts(raw).filter((c) => c.type === "codebook-code")

export const getAllCodes = createFileStoreSelector<CalloutBlock[], CalloutBlock[]>({
  extract: getCodes,
  initial: () => [],
  fold: (acc, codes) => {
    for (const code of codes) acc.push(code)
  },
})

export const findCodeById = (files: FileStore, id: string): CalloutBlock | undefined =>
  findIn(files, getCodes, (c) => c.id === id)

export const getCodeTitle = (files: FileStore, id: string): string | undefined =>
  findCodeById(files, id)?.title

const calloutToCode = (callout: CalloutBlock): Code => ({
  id: callout.id,
  name: callout.title,
  color: callout.color,
  detail: callout.content,
})

export const groupCodesByFile = (files: FileStore): CodeGroup[] =>
  Object.entries(files).reduce<CodeGroup[]>((acc, [filename, raw]) => {
    const codes = getCodes(raw).map(calloutToCode)
    if (codes.length > 0) acc.push({ fileId: filename, name: toDisplayName(filename), codes })
    return acc
  }, [])

export const getResolvedSelectedCodes = (files: FileStore): Code[] => {
  const ids = getSelectedCodes(files)
  return [...ids].flatMap((id) => {
    const code = findCodeById(files, id)
    return code ? [calloutToCode(code)] : []
  })
}

export const getCodebook = (files: FileStore): Codebook | undefined => {
  const categories = groupCodesByFile(files)
  return categories.length === 0 ? undefined : { categories }
}
