import { z } from "zod"
import { openSlotsText, quoteSupported } from "./core.ts"
import type { InterviewStore } from "./interview-store"
import type { SlotUpdate } from "./types"

const UpdateSchema = z.object({
  field: z.string(),
  slot: z.string(),
  value: z.union([z.string(), z.number()]).optional(),
  quote: z.string().optional(),
  skip: z.boolean().optional(),
})

/** JSON.parse that forgives stray closing brackets after the payload, which gpt-4.1-mini sometimes appends. */
function parseLoose(text: string): unknown {
  let t = text.trim()
  for (;;) {
    try {
      return JSON.parse(t)
    } catch (e) {
      if (!/[}\]]$/.test(t)) throw e
      t = t.slice(0, -1).trimEnd()
    }
  }
}

/** The agent sends `updates` as a JSON string (dashboard client tools take flat params). Accept an array too. */
export function parseUpdates(raw: unknown): SlotUpdate[] | null {
  let data = raw
  if (typeof raw === "string") {
    try {
      data = parseLoose(raw)
    } catch {
      return null
    }
  }
  if (!Array.isArray(data) && data && typeof data === "object") data = [data]
  const parsed = z.array(UpdateSchema).safeParse(data)
  if (!parsed.success) return null
  return parsed.data.map((u) => ({
    ...u,
    value: u.value === undefined ? undefined : String(u.value),
  }))
}

/** Client tool `record_answers`. Not wait-for-response, so the return value is a courtesy. */
export function handleRecordAnswers(store: InterviewStore, raw: unknown): string {
  const updates = parseUpdates(raw)
  if (!updates) {
    return 'error: "updates" must be a JSON array like [{"field":"F1","slot":"name","value":"...","quote":"..."}]'
  }
  const { lastApply } = store.dispatch({ type: "updates", updates })
  const accepted = lastApply?.accepted.length ?? 0
  const rejected = lastApply?.rejected ?? []
  if (!rejected.length) return `saved ${accepted}`
  return `saved ${accepted}; rejected ${rejected.length}: ${rejected
    .map((r) => `${r.update.field}.${r.update.slot} (${r.reason})`)
    .join("; ")}`
}

/** Client tool `finish_interview`. Wait-for-response: this is the correctness gate. */
export function handleFinishInterview(store: InterviewStore): string {
  const { session } = store.getState()
  if (!session) return "error: no active form"
  const open = openSlotsText(session)
  if (open) {
    return `not done. Still open: ${open}. Ask about these (or skip them if the user declines), then call finish_interview again.`
  }
  store.dispatch({ type: "finish" })
  return "done. Thank the user and tell them to review the draft answers on screen. They can ask you to change any answer."
}

/**
 * Client tool `edit_answer` (wait-for-response). The instruction must be the user's own words, so
 * a rewrite can't be invented by the agent. `rewrite` does the actual drafting.
 */
export async function handleEditAnswer(
  store: InterviewStore,
  raw: Record<string, unknown>,
  rewrite: (fieldId: string, instruction: string) => Promise<string | null>
): Promise<string> {
  const fieldId = String(raw.field ?? "").trim()
  const instruction = String(raw.instruction ?? "").trim()
  const { session, said } = store.getState()
  if (!session) return "error: no active form"
  if (!session.fields.some((f) => f.id === fieldId)) {
    return `error: unknown field "${fieldId}". Use an id from the plan, like F3.`
  }
  if (!quoteSupported(instruction, said)) {
    return "rejected: instruction must be the user's exact words. Ask them to say it again."
  }
  const text = await rewrite(fieldId, instruction)
  return text
    ? `updated. The new answer is: ${text}`
    : "error: couldn't rewrite that right now. Ask the user to edit it on screen."
}
