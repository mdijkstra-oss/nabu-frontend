import { waitForDatabase, getDatabase } from "./database"

export interface NabuTestHook {
  query: (sql: string) => Promise<unknown[]>
}

declare global {
  interface Window {
    __nabuTest?: NabuTestHook
  }
}

// The flag arrives as a parameter so the `import.meta.env.VITE_E2E` read stays a
// static literal at the call site, where Vite can eliminate the whole branch —
// and so this decision stays testable under vitest, where that literal is live.
export const installTestHook = async (flag: string | undefined): Promise<void> => {
  if (!flag) return
  await waitForDatabase()
  const db = getDatabase()
  if (!db) return
  window.__nabuTest = {
    query: async (sql: string): Promise<unknown[]> => {
      const result = await db.query(sql)
      if (!result.ok) throw new Error(result.error.message)
      return result.value.rows
    },
  }
}
