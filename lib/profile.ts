import { applyPrefill, matchExact, mergeNewest, mergeProfile, profileFromSession, type PrefillFill } from "./core"
import { factsFromOnboarding } from "./profile-gaps"
import { isSensitive, keyOf } from "./profile-keys"
import type { ProfileItem, Session } from "./types"

export const PROFILE_FORMAT = "bolbharo.profile"

const KEY = "bolbharo.profile.v1"

const FORM_SPECIFIC = /why|motivat|cover letter|join us|this role|this company|this position|this job/i

/** Fired in this tab whenever the saved facts change, so the UI can update. */
export const PROFILE_EVENT = "bolbharo:profile"
const notify = () => window.dispatchEvent(new Event(PROFILE_EVENT))

/** A saved fact. The optional onboarding fields are checked only when present, so older data still loads. */
export function valid(p: unknown): p is ProfileItem {
  if (!p || typeof p !== "object") return false
  const o = p as Record<string, unknown>
  const optional = (name: string, type: string) => o[name] === undefined || typeof o[name] === type
  return (
    typeof o.label === "string" &&
    typeof o.slot === "string" &&
    typeof o.value === "string" &&
    typeof o.quote === "string" &&
    typeof o.form === "string" &&
    typeof o.savedAt === "number" &&
    optional("key", "string") &&
    optional("source", "string") &&
    optional("confirmed", "boolean") &&
    optional("sensitive", "boolean") &&
    optional("autofill", "boolean")
  )
}

/**
 * Save facts the person has reviewed. They replace older facts for the same question. Returns how many
 * facts are saved now, or null when storage is blocked.
 */
export function saveReviewed(facts: readonly ProfileItem[], now = Date.now()): number | null {
  const reviewed = facts.map((f) => ({ ...f, confirmed: true, savedAt: now }))
  const merged = mergeNewest(loadProfile(), reviewed)
  return writeProfile(merged) ? merged.length : null
}

/** Facts captured by the onboarding interview, saved as confirmed. Null when storage is blocked. */
export function saveOnboardingAnswers(session: Session, now = Date.now()): number | null {
  return saveReviewed(factsFromOnboarding(session, now), now)
}

/** Replace the facts saved on this device. False when storage is blocked. */
export function writeProfile(items: readonly ProfileItem[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
    notify()
    return true
  } catch {
    return false
  }
}

const clamp = (p: ProfileItem): ProfileItem => ({
  ...p,
  label: p.label.slice(0, 400),
  slot: p.slot.slice(0, 60),
  value: p.value.slice(0, 2000),
  quote: p.quote.slice(0, 2000),
  form: p.form.slice(0, 300),
  key: p.key?.slice(0, 80),
  source: p.source?.slice(0, 60),
})

/** The facts as a JSON file the person can keep, or move to the side panel's own copy. */
export function profileJson(items: readonly ProfileItem[], now = Date.now()): string {
  return JSON.stringify(
    { format: PROFILE_FORMAT, version: 1, exportedAt: new Date(now).toISOString(), facts: items },
    null,
    2
  )
}

/** Read a file made by `profileJson`. Throws a message fit to show. Facts that do not fit are dropped. */
export function parseProfileJson(text: string): ProfileItem[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("That file is not a BolBharo profile.")
  }
  const list = data && typeof data === "object" ? (data as { facts?: unknown }).facts : undefined
  if (!Array.isArray(list)) throw new Error("That file is not a BolBharo profile.")
  const facts = list.filter(valid).map(clamp)
  if (!facts.length) throw new Error("That file has no facts in it.")
  return facts
}

/** The raw saved text, for `useSyncExternalStore`, which needs a value that only changes when the data does. */
export function readStoredProfile(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function parseStoredProfile(raw: string | null): ProfileItem[] {
  try {
    const data: unknown = JSON.parse(raw ?? "[]")
    return Array.isArray(data) ? data.filter(valid) : []
  } catch {
    return []
  }
}

/** Saved facts live only in this browser. Every access is guarded: storage can be blocked. */
export function loadProfile(): ProfileItem[] {
  return parseStoredProfile(readStoredProfile())
}

/** Save this session's confirmed facts, replacing older ones for the same question. Returns the saved count. */
export function saveProfile(session: Session): number {
  try {
    // The person read and approved these in review, so a later form may fill them in without asking again.
    const facts = profileFromSession(session).map((p) => {
      const key = keyOf(p.label)
      // Answers about why this company or role were written for that form, so they are offered, not filled.
      const specific = FORM_SPECIFIC.test(p.label)
      return { ...p, confirmed: !specific, ...(key ? { key, sensitive: isSensitive(key, p.label) } : {}) }
    })
    const merged = mergeProfile(loadProfile(), facts)
    localStorage.setItem(KEY, JSON.stringify(merged))
    notify()
    return merged.length
  } catch {
    return 0
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(KEY)
    notify()
  } catch {
    // storage blocked: nothing was saved anyway
  }
}

/**
 * Pre-fill a new session from saved facts. Same question and slot match for free. If a model key
 * exists, the rest are matched by the server, which only ever returns indexes into the saved list,
 * so a quote can never be invented.
 */
export async function prefillMatches(session: Session, saved: readonly ProfileItem[], useModel = true): Promise<PrefillFill[]> {
  // The onboarding interview asks exactly what the profile lacks, so nothing is pre-filled into it.
  if (session.source === "onboarding" || !saved.length) return []

  const fills: PrefillFill[] = matchExact(session, saved)
  if (useModel) {
    try {
      const usedSaved = new Set(fills.map((f) => saved.indexOf(f.item)))
      const taken = new Set(fills.map((f) => `${f.fieldId}.${f.slot}`))
      const slots = session.fields.flatMap((f) =>
        f.slots
          .filter((s) => s.value === null && !s.skipped && !taken.has(`${f.id}.${s.name}`))
          .map((s) => ({ field: f.id, slot: s.name, ask: s.ask, question: f.label }))
      )
      const left = saved
        .map((p, i) => ({ i, question: p.label, slot: p.slot, value: p.value }))
        .filter((p) => !usedSaved.has(p.i))
      if (slots.length && left.length) {
        const res = await fetch("/api/prefill", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slots, saved: left }),
        })
        if (res.ok) {
          const body = (await res.json()) as {
            fills?: { field: string; slot: string; saved: number }[]
          }
          const legal = new Set(slots.map((s) => `${s.field}.${s.slot}`))
          const seen = new Set<number>()
          for (const m of body.fills ?? []) {
            const item = saved[m.saved]
            const key = `${m.field}.${m.slot}`
            if (!item || !legal.has(key) || taken.has(key) || seen.has(m.saved) || usedSaved.has(m.saved)) continue
            seen.add(m.saved)
            taken.add(key)
            fills.push({ fieldId: m.field, slot: m.slot, item })
          }
        }
      }
    } catch {
      // model matching is a bonus: exact matches still apply
    }
  }
  return fills
}

export async function prefillFromProfile(session: Session, useModel: boolean): Promise<Session> {
  const fills = await prefillMatches(session, loadProfile(), useModel)
  return fills.length ? applyPrefill(session, fills) : session
}

// ---------- Optional: keep the facts in the signed-in Google account too ----------

const SYNC_KEY = "bolbharo.sync.v1"

/** Off until the user turns it on. Local facts stay local otherwise. */
export function syncEnabled(): boolean {
  try {
    return localStorage.getItem(SYNC_KEY) === "1"
  } catch {
    return false
  }
}

export function setSyncEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(SYNC_KEY, "1")
    else localStorage.removeItem(SYNC_KEY)
  } catch {
    // storage blocked: sync simply stays off
  }
  notify()
}

/**
 * After a local edit, the account follows when this device syncs. A removal clears the account first,
 * because the account keeps the newest of every fact and would otherwise hand the removed one back.
 */
export async function afterLocalChange(removed: boolean): Promise<boolean | null> {
  if (!syncEnabled()) return null
  if (removed && !(await deleteSynced())) return false
  return pushProfile()
}

/** One call to the profile route. The facts it returns, or null when it could not be done. */
async function remote(method: "GET" | "PUT" | "DELETE", items?: ProfileItem[]): Promise<ProfileItem[] | null> {
  try {
    const res = await fetch("/api/profile", {
      method,
      headers: items ? { "content-type": "application/json" } : undefined,
      body: items ? JSON.stringify({ items }) : undefined,
    })
    if (!res.ok) return null
    if (method === "DELETE") return []
    const body = (await res.json()) as { items?: unknown }
    return Array.isArray(body.items) ? body.items.filter(valid) : null
  } catch {
    return null
  }
}

/**
 * Bring this device and the account level: take the account's facts, keep the newest per question, and
 * give the account whatever only this device had. Returns how many facts there are now, or null.
 */
export async function syncProfile(): Promise<number | null> {
  const theirs = await remote("GET")
  if (!theirs) return null
  const merged = mergeNewest(loadProfile(), theirs)
  try {
    localStorage.setItem(KEY, JSON.stringify(merged))
    notify()
  } catch {
    return null
  }
  return (await remote("PUT", merged)) ? merged.length : null
}

export async function pushProfile(): Promise<boolean> {
  return (await remote("PUT", loadProfile())) !== null
}

export async function deleteSynced(): Promise<boolean> {
  return (await remote("DELETE")) !== null
}

/** Forget the facts on this device, and in the account when this device was syncing them. */
export async function forgetProfile(): Promise<void> {
  clearProfile()
  if (syncEnabled()) await deleteSynced()
}
