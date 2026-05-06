import { CalloutSchema, type CalloutBlock } from "./schema"
import { getBlocks } from "~/lib/data-blocks/query"
import type { FileStore } from "~/lib/files/store"
import { findIn, findFileFor } from "~/lib/files/collect"

export const getCallouts = (raw: string): CalloutBlock[] =>
  getBlocks(raw, "json-callout", CalloutSchema)

const hasId = (id: string) => (c: CalloutBlock) => c.id === id

export const findCalloutById = (files: FileStore, id: string): CalloutBlock | undefined =>
  findIn(files, getCallouts, hasId(id))

export const findDocumentForCallout = (files: FileStore, id: string): string | undefined =>
  findFileFor(files, getCallouts, hasId(id))
