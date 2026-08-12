import { getBlockUndecorated } from "~/lib/data-blocks/query"
import { RegionsBlockSchema, type RegionsBlock } from "~/domain/data-blocks/regions/schema"
import { REGIONS_LANGUAGE } from "./decorate/resolve"

export const EMPTY_REGIONS: RegionsBlock = { regions: [], scanned: {} }

export const readStoredRegions = (raw: string): RegionsBlock =>
  getBlockUndecorated(raw, REGIONS_LANGUAGE, RegionsBlockSchema) ?? EMPTY_REGIONS
