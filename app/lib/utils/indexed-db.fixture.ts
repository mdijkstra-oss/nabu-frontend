interface Scope {
  indexedDB?: unknown
}

const scope = globalThis as Scope

export const openTracker = (): string[] => {
  const opened: string[] = []
  scope.indexedDB = {
    open: (name: string) => {
      opened.push(name)
      throw new Error("indexedDB.open must not be reached")
    },
  }
  return opened
}

export const withoutIndexedDb = (): void => {
  delete scope.indexedDB
}
