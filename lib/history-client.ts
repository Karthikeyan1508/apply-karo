import { mergeRecords, parseHistory, recordFromSession, type FormRecord } from "./history"
import type { Session } from "./types"

const KEY = "bolbharo.history.v1"
export const HISTORY_EVENT = "bolbharo:history"
const notify = () => window.dispatchEvent(new Event(HISTORY_EVENT))

/** The raw saved text, for `useSyncExternalStore`, which needs a value that only changes when the data does. */
export function readHistoryRaw(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export const loadHistory = (): FormRecord[] => parseHistory(readHistoryRaw())

function write(records: readonly FormRecord[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(records))
    notify()
    return true
  } catch {
    return false
  }
}

/** One call to the history route. False when it could not be done (not signed in, no database, offline). */
async function remote(method: "PUT" | "DELETE", body: unknown): Promise<boolean> {
  try {
    const res = await fetch("/api/history", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    return res.ok
  } catch {
    return false
  }
}

/** Keep a form the person approved: on this device, and in their account when they are signed in. */
export async function recordForm(session: Session, now = Date.now()): Promise<FormRecord | null> {
  const record = recordFromSession(session, now)
  if (!record) return null
  write(mergeRecords(loadHistory(), [record]))
  await remote("PUT", record)
  return record
}

export async function removeRecord(id: string): Promise<void> {
  write(loadHistory().filter((r) => r.id !== id))
  await remote("DELETE", { id })
}

export async function clearHistory(): Promise<void> {
  write([])
  await remote("DELETE", { all: true })
}

/**
 * Bring this device and the account level: take the account's forms, keep the newest per form, and give the
 * account any form only this device has. Quiet when signed out.
 */
export async function syncHistory(): Promise<void> {
  try {
    const res = await fetch("/api/history", { cache: "no-store" })
    if (!res.ok) return
    const body = (await res.json()) as { records?: unknown }
    const theirs = parseHistory(JSON.stringify(body.records ?? []))
    const mine = loadHistory()
    write(mergeRecords(mine, theirs))
    const known = new Set(theirs.map((r) => `${r.id}:${r.filledAt}`))
    for (const r of mine) if (!known.has(`${r.id}:${r.filledAt}`)) await remote("PUT", r)
  } catch {
    // offline or blocked: the forms are still on this device
  }
}

/** Delete the account's copy of every form, keeping this device's. */
export const deleteSyncedHistory = () => remote("DELETE", { all: true })
