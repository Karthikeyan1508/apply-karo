import { z } from "zod"
import { draftFallback } from "./core"
import type { Session } from "./types"

/** A form read off a web page by the browser extension: any site, not just Google Forms. */
export const PageForm = z.object({
  title: z.string().max(300).default(""),
  url: z.string().max(2000).optional(),
  fields: z
    .array(
      z.object({
        /** The extension's handle for the control on the page. It is sent back to fill it. */
        ref: z.string().max(40),
        label: z.string().min(1).max(500),
        kind: z.enum(["text", "long_text", "choice"]),
        options: z.array(z.string().max(300)).max(80).default([]),
        multi: z.boolean().default(false),
        required: z.boolean().default(false),
      })
    )
    .min(1)
    .max(100),
})
export type PageFormData = z.infer<typeof PageForm>

export const isExtensionOrigin = (origin: string) =>
  origin.startsWith("chrome-extension://")

/** What to type into the page: the approved answer for each question that has one. */
export function fillPayload(
  session: Session
): { ref: string; value: string }[] {
  return session.fields
    .filter((f) => f.entryId && f.draft.trim())
    .map((f) => ({ ref: f.entryId as string, value: f.draft.trim() }))
}

/**
 * What Autofill types into the page right away: the questions the saved profile (or the repos the person chose)
 * fully answers, and nothing still waiting for the person's yes (sensitive facts, facts to confirm). Anything
 * else is left for the interview.
 */
export function autofillPayload(session: Session): { ref: string; value: string }[] {
  return session.fields
    // Only questions the interviewer understood and has enough to answer.
    .filter((f) => !f.check || (f.check.understood && f.check.enough))
    .filter((f) => f.entryId && f.slots.length > 0 && f.slots.every((s) => (s.value !== null && !s.fromProfile) || (s.skipped && s.value === null)) && f.slots.some((s) => s.value !== null))
    // A question with several parts is filled with its written answer, once it has one.
    .map((f) => ({ ref: f.entryId as string, value: f.slots.length === 1 && !(f.kind === "long_text" && f.draft.trim()) ? (f.slots[0].value as string).trim() : f.draft.trim() || draftFallback(f).trim() }))
    .filter((x) => x.value)
}

/**
 * The same page read again (Autofill re-reads it): keep what was already answered in this interview, so
 * answers given in the chat are not lost and are what gets typed into the page.
 */
export function carryAnswers(old: Session | null | undefined, fresh: Session): Session {
  if (!old || old.source !== "page") return fresh
  const label = (s: string) => s.trim().toLowerCase()
  const before = new Map(old.fields.map((f) => [label(f.label), f]))
  let kept = false
  const fields = fresh.fields.map((f) => {
    const o = before.get(label(f.label))
    if (!o || o.slots.length !== f.slots.length || !o.slots.every((s, i) => s.name === f.slots[i].name)) return f
    const slots = f.slots.map((s, i) => (s.value === null && o.slots[i].value !== null ? { ...o.slots[i] } : s))
    if (slots.every((s, i) => s === f.slots[i])) return f
    kept = true
    // Answered in the interview, so the readiness verdict on the empty question no longer applies.
    return { ...f, slots, draft: f.draft || o.draft, check: undefined }
  })
  return kept ? { ...fresh, fields } : fresh
}
