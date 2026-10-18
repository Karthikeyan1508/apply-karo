import { neon } from "@neondatabase/serverless"
import { AppError } from "./errors"
import { MAX_RECORDS, type FormRecord } from "./history"

/** The person's filled forms, one row per form, in the same database as the synced facts. */
export interface HistoryStore {
  list(sub: string): Promise<FormRecord[]>
  put(sub: string, record: FormRecord): Promise<void>
  /** One form, or every form when no id is given. */
  remove(sub: string, id?: string): Promise<void>
}

function postgres(url: string): HistoryStore {
  const sql = neon(url)
  let ready: Promise<unknown> | null = null
  const table = () =>
    (ready ??= sql`create table if not exists filled_forms (
      sub text not null,
      id text not null,
      filled_at bigint not null,
      record jsonb not null,
      primary key (sub, id)
    )`)
  return {
    async list(sub) {
      await table()
      const rows = await sql`select record from filled_forms where sub = ${sub} order by filled_at desc limit ${MAX_RECORDS}`
      return rows.map((r) => r.record as FormRecord)
    },
    async put(sub, record) {
      await table()
      await sql`insert into filled_forms (sub, id, filled_at, record)
        values (${sub}, ${record.id}, ${record.filledAt}, ${JSON.stringify(record)}::jsonb)
        on conflict (sub, id) do update set filled_at = excluded.filled_at, record = excluded.record`
    },
    async remove(sub, id) {
      await table()
      if (id) await sql`delete from filled_forms where sub = ${sub} and id = ${id}`
      else await sql`delete from filled_forms where sub = ${sub}`
    },
  }
}

/** In memory. For tests, and never chosen by the app itself. */
export function memoryHistory(): HistoryStore {
  const rows = new Map<string, Map<string, FormRecord>>()
  const of = (sub: string) => rows.get(sub) ?? rows.set(sub, new Map()).get(sub)!
  return {
    list: async (sub) => [...of(sub).values()].sort((a, b) => b.filledAt - a.filledAt),
    put: async (sub, r) => void of(sub).set(r.id, r),
    remove: async (sub, id) => void (id ? of(sub).delete(id) : of(sub).clear()),
  }
}

let override: HistoryStore | null = null
let cached: { url: string; store: HistoryStore } | null = null

/** Tests only. */
export const setHistoryStore = (s: HistoryStore | null) => void (override = s)

/** The store, or null when no DATABASE_URL is set (history then stays on the device). */
export function historyStore(url = process.env.DATABASE_URL?.trim()): HistoryStore | null {
  if (override) return override
  if (!url) return null
  if (cached?.url !== url) cached = { url, store: postgres(url) }
  return cached.store
}

/** Run a store call; a database outage becomes an error the page can show. */
export async function guardedHistory<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof AppError) throw e
    console.error("history store failed:", e instanceof Error ? e.message : e)
    throw new AppError("SYNC_FAILED", 502, "Couldn't reach the database. Your forms are still saved on this device.")
  }
}
