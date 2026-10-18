import { confirmedFacts, draftFlags, factSignature } from "./core"
import type { InterviewStore } from "./interview-store"
import type { ApiError, FormField } from "./types"

export interface DraftResult {
  draft: string
  source: "llm" | "fallback"
}

/** Ask the server to draft one answer from the user's confirmed facts. Throws on network or server errors. */
export async function requestDraft(
  field: FormField,
  opts: { style?: string; current?: string } = {}
): Promise<DraftResult> {
  const facts = confirmedFacts(field).map(({ slot, value }) => ({ slot, value }))
  const res = await fetch("/api/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      field: {
        label: field.label,
        intent: field.intent,
        kind: field.kind,
        options: field.options,
        multi: field.multi,
        maxChars: field.maxChars,
      },
      facts,
      style: opts.style,
      current: opts.current,
    }),
  })
  const body = (await res.json()) as DraftResult | ApiError
  if (!res.ok || "error" in body) {
    throw new Error("error" in body ? body.error.message : "Drafting failed.")
  }
  return body
}

export type RewriteResult = { text: string } | { error: "no_llm" | "failed" }

/**
 * Rewrite one answer from the user's own instruction. Needs the language model: without a key the
 * server can only join facts, which would ignore the instruction, so that counts as a failure.
 */
export async function rewriteField(
  store: InterviewStore,
  fieldId: string,
  instruction: string
): Promise<RewriteResult> {
  const field = store.getState().session?.fields.find((f) => f.id === fieldId)
  if (!field) return { error: "failed" }
  store.dispatch({ type: "drafting", ids: [fieldId], on: true })
  try {
    const r = await requestDraft(field, { style: instruction, current: field.draft })
    if (r.source === "fallback") return { error: "no_llm" }
    store.dispatch({
      type: "draft",
      fieldId,
      text: r.draft,
      flags: draftFlags(field, r.draft, instruction),
      sig: factSignature(field),
      edited: true,
    })
    return { text: r.draft }
  } catch {
    return { error: "failed" }
  } finally {
    store.dispatch({ type: "drafting", ids: [fieldId], on: false })
  }
}
