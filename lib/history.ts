import type { Session } from "./types"

/**
 * Every form the person approved, with its questions and their answers: kept on this device, and in their
 * account whenever they are signed in. This is what the dashboard shows.
 */

export interface FormRecord {
  id: string
  title: string
  /** Where the form lives, without its query string or fragment (those can hold tokens). */
  url: string | null
  /** google, text, page, demo... */
  source: string
  filledAt: number
  answers: { question: string; answer: string }[]
}

export const MAX_RECORDS = 300

/** The address with only its origin and path. */
export function cleanUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? `${u.origin}${u.pathname}` : null
  } catch {
    return null
  }
}

/**
 * The record for an approved session, or null when there is nothing to keep: the onboarding interview
 * is about the person, not a form, and the scripted demos are not real forms.
 */
export function recordFromSession(session: Session, now = Date.now()): FormRecord | null {
  if (session.source === "onboarding" || session.source === "demo") return null
  const answers = session.fields.flatMap((f) => {
    const answer =
      f.draft.trim() ||
      f.slots
        .map((s) => s.value?.trim())
        .filter(Boolean)
        .join("; ")
    return answer ? [{ question: f.label, answer }] : []
  })
  if (!answers.length) return null
  return { id: session.id, title: session.title, url: cleanUrl(session.formUrl), source: session.source, filledAt: now, answers }
}

/** Newest per id, newest first, capped. Merging twice changes nothing. */
export function mergeRecords(a: readonly FormRecord[], b: readonly FormRecord[]): FormRecord[] {
  const map = new Map<string, FormRecord>()
  for (const r of [...a, ...b]) {
    const have = map.get(r.id)
    if (!have || r.filledAt >= have.filledAt) map.set(r.id, r)
  }
  return [...map.values()].sort((x, y) => y.filledAt - x.filledAt).slice(0, MAX_RECORDS)
}

export function validRecord(r: unknown): r is FormRecord {
  if (!r || typeof r !== "object") return false
  const o = r as Record<string, unknown>
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    (o.url === null || typeof o.url === "string") &&
    typeof o.source === "string" &&
    typeof o.filledAt === "number" &&
    Array.isArray(o.answers) &&
    o.answers.every((a) => a && typeof a.question === "string" && typeof a.answer === "string")
  )
}

export function parseHistory(raw: string | null): FormRecord[] {
  try {
    const data: unknown = JSON.parse(raw ?? "[]")
    return Array.isArray(data) ? data.filter(validRecord) : []
  } catch {
    return []
  }
}
