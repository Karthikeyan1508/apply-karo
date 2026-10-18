import { z } from "zod"
import type { InterviewState } from "./interview-store"

/** The interview is saved in this browser so a refresh, a crash or a closed tab does not lose it. */
const KEY = "bolbharo.session.v1"
export const SESSION_EVENT = "bolbharo:session"
const MAX_BYTES = 1_500_000

export type SavedState = Pick<
  InterviewState,
  "phase" | "transcript" | "said" | "guardLog" | "lastFieldId" | "startedAt" | "finishedAt" | "finishedVia"
> & { session: NonNullable<InterviewState["session"]> }

export interface Saved {
  v: 1
  savedAt: number
  state: SavedState
}

// Loose on purpose: enough to refuse corrupt or foreign data, tolerant of fields added later.
const Slot = z.object({ name: z.string(), value: z.string().nullable() }).passthrough()
const Field = z.object({ id: z.string(), label: z.string(), slots: z.array(Slot) }).passthrough()
const Schema = z.object({
  v: z.literal(1),
  savedAt: z.number(),
  state: z.object({
    phase: z.enum(["interview", "complete", "approved"]),
    session: z.object({ id: z.string(), title: z.string(), fields: z.array(Field) }).passthrough(),
    transcript: z.array(z.object({ id: z.string(), role: z.enum(["user", "agent"]), text: z.string(), at: z.number() })),
    said: z.array(z.string()),
    guardLog: z.array(z.object({ id: z.string(), at: z.number(), accepted: z.boolean() }).passthrough()),
    lastFieldId: z.string().nullable(),
    startedAt: z.number().nullable(),
    finishedAt: z.number().nullable().default(null),
    finishedVia: z.enum(["voice", "text", "demo"]).nullable().default(null),
  }),
})

export function parseSaved(raw: string | null): Saved | null {
  if (!raw) return null
  try {
    const r = Schema.safeParse(JSON.parse(raw))
    return r.success ? (r.data as unknown as Saved) : null
  } catch {
    return null
  }
}

/** What to store for this state, or null when there is nothing worth keeping (landing page, or too big). */
export function serialize(state: InterviewState, now = Date.now()): string | null {
  if (state.phase === "landing" || !state.session) return null
  const saved: Saved = {
    v: 1,
    savedAt: now,
    state: {
      phase: state.phase,
      session: state.session,
      transcript: state.transcript,
      said: state.said,
      guardLog: state.guardLog,
      lastFieldId: state.lastFieldId,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      finishedVia: state.finishedVia,
    },
  }
  const text = JSON.stringify(saved)
  return text.length > MAX_BYTES ? null : text
}

const notify = () => window.dispatchEvent(new Event(SESSION_EVENT))

/** Every storage access is guarded: storage can be blocked or full. */
export function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Save this state, or forget the saved one when there is nothing to keep. */
export function writeSaved(state: InterviewState): void {
  try {
    const text = serialize(state)
    if (text) localStorage.setItem(KEY, text)
    else localStorage.removeItem(KEY)
    notify()
  } catch {
    // storage blocked or full: the interview still works, it just can't be resumed
  }
}

export function clearSaved(): void {
  try {
    localStorage.removeItem(KEY)
    notify()
  } catch {
    // nothing was saved anyway
  }
}

/** "just now", "5 min ago", "2 h ago". */
export function ago(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - at) / 60_000))
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}
