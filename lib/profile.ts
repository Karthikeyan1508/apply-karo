import {
  applyPrefill,
  derivedValue,
  matchExact,
  mergeNewest,
  mergeProfile,
  profileFromSession,
  type PrefillFill,
} from "./core"
import { factsFromOnboarding } from "./profile-gaps"
import { isSensitive, keyOf } from "./profile-keys"
import type { ProfileItem, Session } from "./types"

export const PROFILE_FORMAT = "bolbharo.profile"

const KEY = "bolbharo.profile.v1"

/** How many saved facts one matching call may look at. Groq limits tokens per minute, so the call stays small. */
const MODEL_FACTS = 90

const FORM_SPECIFIC = /why|motivat|cover letter|join us|this role|this company|this position|this job/i

/** Fired in this tab whenever the saved facts change, so the UI can update. */
export const PROFILE_EVENT = "bolbharo:profile"
const notify = () => window.dispatchEvent(new Event(PROFILE_EVENT))
const DECISION_CATEGORIES = new Set([
  "ownership",
  "decision",
  "tradeoff",
  "impact",
  "outcome",
  "motivation",
])

/** A saved fact. The optional onboarding fields are checked only when present, so older data still loads. */
export function valid(p: unknown): p is ProfileItem {
  if (!p || typeof p !== "object") return false
  const o = p as Record<string, unknown>
  const optional = (name: string, type: string) =>
    o[name] === undefined || typeof o[name] === type
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
    optional("autofill", "boolean") &&
    optional("hidden", "boolean") &&
    (o.kind === undefined || o.kind === "decision") &&
    optional("subjectKey", "string") &&
    (o.category === undefined ||
      (typeof o.category === "string" &&
        DECISION_CATEGORIES.has(o.category))) &&
    (o.kind !== "decision" ||
      (typeof o.key === "string" &&
        typeof o.subjectKey === "string" &&
        typeof o.category === "string" &&
        DECISION_CATEGORIES.has(o.category)))
  )
}

/**
 * Save facts the person has reviewed. They replace older facts for the same question. Returns how many
 * facts are saved now, or null when storage is blocked.
 */
export function saveReviewed(
  facts: readonly ProfileItem[],
  now = Date.now()
): number | null {
  const reviewed = facts.map((f) => ({ ...f, confirmed: true, savedAt: now }))
  const merged = mergeNewest(loadProfile(), reviewed)
  return writeProfile(merged) ? merged.length : null
}

/** Facts captured by the onboarding interview, saved as confirmed. Null when storage is blocked. */
export function saveOnboardingAnswers(
  session: Session,
  now = Date.now()
): number | null {
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
  subjectKey: p.subjectKey?.slice(0, 80),
})

/** Facts the person can see and edit: everything except what was read from the resume. */
export const shown = (items: readonly ProfileItem[]) => items.filter((f) => !f.hidden)

/** The facts as a JSON file the person can keep, or move to the side panel's own copy. */
export function profileJson(
  items: readonly ProfileItem[],
  now = Date.now()
): string {
  return JSON.stringify(
    {
      format: PROFILE_FORMAT,
      version: 1,
      exportedAt: new Date(now).toISOString(),
      facts: items,
    },
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
  const list =
    data && typeof data === "object"
      ? (data as { facts?: unknown }).facts
      : undefined
  if (!Array.isArray(list))
    throw new Error("That file is not a BolBharo profile.")
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
export async function prefillMatches(session: Session, all: readonly ProfileItem[], useModel = true): Promise<PrefillFill[]> {
  // The onboarding interview asks exactly what the profile lacks, so nothing is pre-filled into it.
  if (session.source === "onboarding") return []
  // Decisions recorded in a grill session are not facts to fill forms with.
  const saved = all.filter((p) => p.kind !== "decision")
  if (!saved.length) return []

  const fills: PrefillFill[] = matchExact(session, saved)
  if (useModel) {
    try {
      const taken = new Set(fills.map((f) => `${f.fieldId}.${f.slot}`))
      const slots = session.fields
        .flatMap((f) =>
          f.slots
            .filter((s) => s.value === null && !s.skipped && !taken.has(`${f.id}.${s.name}`))
            .map((s) => ({ field: f.id, slot: s.name, ask: s.ask, question: f.label }))
        )
        .slice(0, 80)
      // The model sees the plain facts (name, email, college...) first, trimmed, so the call stays small.
      const pool = saved
        .map((p, i) => ({ p, i }))
        .sort((x, y) => Number(Boolean(y.p.key && !y.p.key.includes(":"))) - Number(Boolean(x.p.key && !x.p.key.includes(":"))))
        .slice(0, MODEL_FACTS)
      const left = pool.map(({ p, i }) => ({
        i,
        question: p.label,
        slot: p.slot,
        value: p.value.slice(0, 120),
        ...(p.key ? { key: p.key } : {}),
      }))
      if (slots.length && left.length) {
        const res = await fetch("/api/prefill", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slots, saved: left }),
        })
        if (res.ok) {
          const body = (await res.json()) as {
            fills?: { field: string; slot: string; saved: number; value?: string }[]
          }
          const legal = new Set(slots.map((s) => `${s.field}.${s.slot}`))
          const inPool = new Set(pool.map((x) => x.i))
          for (const m of body.fills ?? []) {
            const item = inPool.has(m.saved) ? saved[m.saved] : undefined
            const key = `${m.field}.${m.slot}`
            if (!item || !legal.has(key) || taken.has(key)) continue
            // The value may be a part of the fact (a first name), never more than the fact holds.
            const value = m.value ? derivedValue(item, m.value) : item.value
            if (!value) continue
            taken.add(key)
            fills.push({ fieldId: m.field, slot: m.slot, item: value === item.value ? item : { ...item, value } })
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

/**
 * Saved facts are always kept in the account too. Signed out, or without a database, those calls just fail
 * quietly and the facts stay on this device.
 */
export const syncEnabled = () => true

/** True when there is no account to keep facts in: nobody signed in, or no database. Quiet on failure. */
async function noAccount(): Promise<boolean> {
  try {
    const info = (await (await fetch("/api/account", { cache: "no-store" })).json()) as { user?: unknown; sync?: boolean }
    return !info.user || !info.sync
  } catch {
    return true
  }
}

/**
 * After a local edit, the account follows. A removal clears the account first, because the account keeps
 * the newest of every fact and would otherwise hand the removed one back. Null when there is no account.
 */
export async function afterLocalChange(removed: boolean): Promise<boolean | null> {
  if (await noAccount()) return null
  if (removed && !(await deleteSynced())) return false
  return pushProfile()
}

/** One call to the profile route. The facts it returns, or null when it could not be done. */
async function remote(
  method: "GET" | "PUT" | "DELETE",
  items?: ProfileItem[]
): Promise<ProfileItem[] | null> {
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
