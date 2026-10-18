/**
 * The person's resume file, kept in this browser (IndexedDB, which holds files that localStorage cannot) so
 * the profile can show it again. It is never uploaded anywhere for storage.
 */

const DB = "bolbharo-files"
const STORE = "files"
const KEY = "resume"
export const RESUME_EVENT = "bolbharo:resume"

export interface StoredResume {
  name: string
  type: string
  size: number
  savedAt: number
  blob: Blob
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

const notify = () => window.dispatchEvent(new Event(RESUME_EVENT))

/** Keep this file as the person's resume. False when the browser will not store it. */
export async function saveResume(file: Blob, name: string, now = Date.now()): Promise<boolean> {
  try {
    const entry: StoredResume = { name, type: file.type || "application/octet-stream", size: file.size, savedAt: now, blob: file }
    await run("readwrite", (s) => s.put(entry, KEY))
    notify()
    return true
  } catch {
    return false
  }
}

export async function loadResume(): Promise<StoredResume | null> {
  try {
    return ((await run("readonly", (s) => s.get(KEY))) as StoredResume | undefined) ?? null
  } catch {
    return null
  }
}

export async function removeResume(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY))
  } catch {
    // nothing was stored
  }
  notify()
}

/** The text of a pasted resume, as a file that can be shown and downloaded like an uploaded one. */
export const textFile = (text: string) => new Blob([text], { type: "text/plain" })
