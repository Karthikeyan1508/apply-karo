import { neon } from "@neondatabase/serverless"
import { mergeNewest } from "./core"
import { AppError } from "./errors"
import type { ProfileItem } from "./types"

/** Saved facts for a signed-in user, one row per Google account. Only used when the user turns sync on. */
export interface ProfileStore {
  get(sub: string): Promise<ProfileItem[]>
  /** Merge into what is stored, newest fact per question wins. Returns what is stored now. */
  put(sub: string, items: ProfileItem[]): Promise<ProfileItem[]>
  remove(sub: string): Promise<void>
}

function postgres(url: string): ProfileStore {
  const sql = neon(url)
  let ready: Promise<unknown> | null = null
  // One table, created on first use, so there is no migration step to forget.
  const table = () =>
    (ready ??= sql`create table if not exists profiles (
      sub text primary key,
      items jsonb not null,
      updated_at timestamptz not null default now()
    )`)
  const read = async (sub: string) => {
    await table()
    const rows = await sql`select items from profiles where sub = ${sub}`
    return (rows[0]?.items ?? []) as ProfileItem[]
  }
  return {
    get: read,
    async put(sub, items) {
      const merged = mergeNewest(await read(sub), items)
      await sql`insert into profiles (sub, items) values (${sub}, ${JSON.stringify(merged)}::jsonb)
        on conflict (sub) do update set items = excluded.items, updated_at = now()`
      return merged
    },
    async remove(sub) {
      await table()
      await sql`delete from profiles where sub = ${sub}`
    },
  }
}

/** In memory. For tests, and never chosen by the app itself. */
export function memoryStore(): ProfileStore {
  const rows = new Map<string, ProfileItem[]>()
  return {
    get: async (sub) => rows.get(sub) ?? [],
    async put(sub, items) {
      const merged = mergeNewest(rows.get(sub) ?? [], items)
      rows.set(sub, merged)
      return merged
    },
    remove: async (sub) => void rows.delete(sub),
  }
}

let override: ProfileStore | null = null
let cached: { url: string; store: ProfileStore } | null = null

/** Tests only. */
export const setProfileStore = (s: ProfileStore | null) => void (override = s)

/** The store, or null when no DATABASE_URL is set (sync is then simply unavailable). */
export function profileStore(url = process.env.DATABASE_URL?.trim()): ProfileStore | null {
  if (override) return override
  if (!url) return null
  if (cached?.url !== url) cached = { url, store: postgres(url) }
  return cached.store
}

/** Run a store call; a database outage becomes an error the page can show. */
export async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof AppError) throw e
    console.error("profile store failed:", e instanceof Error ? e.message : e)
    throw new AppError("SYNC_FAILED", 502, "Couldn't reach the database. Your facts are still saved on this device.")
  }
}
