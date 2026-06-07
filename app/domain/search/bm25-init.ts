import { subscribe, getFiles } from "~/lib/files/store"
import { startBm25Sync } from "~/lib/search/bm25/sync"

export const startBm25 = (): Promise<void> => startBm25Sync({ getFiles, subscribe }).ready
