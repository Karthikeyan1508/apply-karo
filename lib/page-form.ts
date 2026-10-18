import { z } from "zod"
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
 * What Autofill types into the page right away: the questions the saved profile fully answers. Single-question
 * fields only, and nothing still waiting for the person's yes (sensitive facts, facts to confirm). Anything else
 * is left for the interview.
 */
export function autofillPayload(session: Session): { ref: string; value: string }[] {
  return session.fields
    .filter((f) => f.entryId && f.slots.length === 1 && f.slots[0].value !== null && !f.slots[0].fromProfile)
    .map((f) => ({ ref: f.entryId as string, value: (f.slots[0].value as string).trim() }))
    .filter((x) => x.value)
}
