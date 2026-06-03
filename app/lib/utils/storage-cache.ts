import { fnvHash } from "./hash"

let cacheSkipped = false

export const setCacheSkipped = (skip: boolean): void => {
  cacheSkipped = skip
}

export const isCacheSkipped = (): boolean => cacheSkipped

const STORE_NAME = "kv"
const DB_VERSION = 1
const SEQ_INDEX = "seq"
const SEQ_FIELD = "seq"
const EVICT_RATIO = 0.1

interface CacheEnvelope<T> {
  value: T
  seq: number
  label?: string
}

let lastSeq = 0

const nextSeq = (): number => {
  const now = Date.now()
  lastSeq = now > lastSeq ? now : lastSeq + 1
  return lastSeq
}

const openDb = (name: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME)
      const store = db.createObjectStore(STORE_NAME)
      store.createIndex(SEQ_INDEX, SEQ_FIELD)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const dbCache = new Map<string, Promise<IDBDatabase>>()

const getDb = (prefix: string): Promise<IDBDatabase> => {
  const dbName = `cache:${prefix}`
  const existing = dbCache.get(dbName)
  if (existing) return existing
  const promise = openDb(dbName)
  dbCache.set(dbName, promise)
  return promise
}

const idbGet = <T>(db: IDBDatabase, key: string): Promise<T | undefined> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const request = tx.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => {
      const envelope = request.result as CacheEnvelope<T> | undefined
      resolve(envelope?.value)
    }
    request.onerror = () => reject(request.error)
  })

const idbPut = <T>(db: IDBDatabase, key: string, value: T, label?: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const envelope: CacheEnvelope<T> = { value, seq: nextSeq(), label }
    const request = tx.objectStore(STORE_NAME).put(envelope, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

const idbCount = (db: IDBDatabase): Promise<number> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const request = tx.objectStore(STORE_NAME).count()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const idbDeleteOldest = (db: IDBDatabase, count: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const index = tx.objectStore(STORE_NAME).index(SEQ_INDEX)
    const request = index.openCursor()
    let deleted = 0
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || deleted >= count) {
        resolve()
        return
      }
      cursor.delete()
      deleted++
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })

const pendingEvictions = new Set<string>()

const tryEvict = async (db: IDBDatabase, prefix: string, cap: number): Promise<void> => {
  if (pendingEvictions.has(prefix)) return
  pendingEvictions.add(prefix)
  try {
    const count = await idbCount(db)
    if (count > cap) await idbDeleteOldest(db, Math.ceil(cap * EVICT_RATIO))
  } finally {
    pendingEvictions.delete(prefix)
  }
}

const ignoreError = (): undefined => undefined

const scheduleEviction = (db: IDBDatabase, prefix: string, cap: number): void => {
  tryEvict(db, prefix, cap).catch(ignoreError)
}

export const buildKey = (args: string[]): string => fnvHash(args.join("\0"))

export const tryGet = async <T>(prefix: string, key: string): Promise<T | undefined> => {
  if (cacheSkipped) return undefined
  try {
    const db = await getDb(prefix)
    return await idbGet<T>(db, key)
  } catch {
    return undefined
  }
}

export const tryPut = async <T>(
  prefix: string,
  key: string,
  value: T,
  cap?: number,
  label?: string
): Promise<void> => {
  if (cacheSkipped) return
  try {
    const db = await getDb(prefix)
    await idbPut(db, key, value, label)
    if (cap !== undefined) scheduleEviction(db, prefix, cap)
  } catch {
    /* */
  }
}

export const clearAllCaches = async (): Promise<void> => {
  const names = [...dbCache.keys()]
  for (const name of names) {
    try {
      const db = await dbCache.get(name)
      db?.close()
    } catch {
      /* close may fail on already-closed db */
    }
    dbCache.delete(name)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

export const cacheInStorage =
  <Args extends string[], T>(
    prefix: string,
    fn: (...args: Args) => Promise<T>,
    cap?: number
  ): ((...args: Args) => Promise<T>) =>
  async (...args: Args): Promise<T> => {
    const key = buildKey(args)
    const cached = await tryGet<T>(prefix, key)
    if (cached !== undefined) return cached

    const result = await fn(...args)
    await tryPut(prefix, key, result, cap)
    return result
  }
