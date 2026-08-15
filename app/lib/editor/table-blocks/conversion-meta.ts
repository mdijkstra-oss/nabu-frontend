// A prosemirror node view mounts after the transaction that created its node, so
// it can never read that transaction's meta — the id waits here instead.
const pending = new Set<string>()

export const markConverted = (id: string): void => {
  pending.add(id)
}

export const claimConverted = (id: string): boolean => pending.delete(id)
