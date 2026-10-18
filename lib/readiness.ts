import { profileDigest } from "./profile-digest"
import type { FormField, ProfileItem, Session } from "./types"

export interface Check {
  id: string
  understood: boolean
  enough: boolean
  needs: string
}

/** The form with each question's check attached. A question the model said nothing about stays unchecked. */
export function applyChecks(session: Session, checks: readonly Check[]): Session {
  const by = new Map(checks.map((c) => [c.id, c]))
  return {
    ...session,
    fields: session.fields.map((f) => {
      const c = by.get(f.id)
      return c ? { ...f, check: { understood: c.understood, enough: c.enough, needs: c.needs.trim().slice(0, 160) } } : f
    }),
  }
}

/** Ready means understood and enough. A question that was never checked is not held back. */
export const ready = (f: Pick<FormField, "check">) => !f.check || (f.check.understood && f.check.enough)

/** One line per question the interviewer is not ready for, in the agent's own words. */
export function notReadyText(session: Session): string {
  return session.fields
    .filter((f) => !ready(f))
    .map((f) => `${f.id} (${f.label}): ${f.check!.understood ? "missing" : "unclear"}: ${f.check!.needs || "ask the person"}`)
    .join("; ")
}

/**
 * Before any answer is filled: is each question understood, and is there enough context (the person's saved
 * facts, the form's notes) to answer it? Failures leave the form as it was: this never blocks the interview.
 */
export async function checkReadiness(session: Session, facts: readonly ProfileItem[]): Promise<Session> {
  if (session.source === "onboarding" || session.source === "demo" || !session.fields.length) return session
  try {
    const res = await fetch("/api/readiness", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questions: session.fields.map((f) => ({ id: f.id, label: f.label, kind: f.kind, options: f.options, intent: f.intent })),
        known: profileDigest(facts),
        notes: `${session.title}. ${session.context}`.slice(0, 3900),
      }),
    })
    if (!res.ok) return session
    const body = (await res.json()) as { checks?: Check[] }
    return applyChecks(session, body.checks ?? [])
  } catch {
    return session
  }
}
