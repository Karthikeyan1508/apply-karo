import { applyDocFacts, openSlots, validDocFills, type DocFill } from "./core"
import type { ApiError, Session } from "./types"

export interface Doc {
  text: string
  /** Shown to the user as the source of each fact: a file name, or "your resume" for pasted text. */
  name: string
}

export const wordsIn = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

async function json<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as T | ApiError | null
  if (!res.ok || !body || (typeof body === "object" && "error" in body)) {
    throw new Error(body && typeof body === "object" && "error" in body ? body.error.message : fallback)
  }
  return body
}

/** Send a PDF or text file to be turned into plain text. Throws a message fit to show the user. */
export async function uploadDocument(file: File): Promise<Doc> {
  const body = new FormData()
  body.set("file", file)
  const { text } = await json<{ text: string }>(
    await fetch("/api/document", { method: "POST", body }),
    "Couldn't read that file."
  )
  return { text, name: file.name }
}

/**
 * Pre-fill the still-open slots from the document. Each quote is checked against the document again
 * here, so the page never takes the server's word that a quote is real.
 */
export async function prefillFromDocument(session: Session, doc: Doc): Promise<Session> {
  const slots = openSlots(session).map((o) => ({
    field: o.fieldId,
    slot: o.slot,
    ask: o.ask,
    question: o.fieldLabel,
  }))
  if (!slots.length) return session
  const { fills } = await json<{ fills: DocFill[] }>(
    await fetch("/api/document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: doc.text, slots }),
    }),
    "Couldn't read your document."
  )
  return applyDocFacts(session, validDocFills(fills, doc.text, session), doc.name)
}
