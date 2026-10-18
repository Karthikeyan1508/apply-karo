"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import {
  draftFallback,
  draftFlags,
  factSignature,
  needsDraft,
} from "@/lib/core"
import { DEMO_DRAFTS } from "@/lib/demo"
import { requestDraft } from "@/lib/draft-client"
import { replayMode } from "@/lib/replay"
import { useInterview, useInterviewStore } from "./use-interview"

const DEBOUNCE_MS = 1400

/**
 * Keeps a draft answer ready for every field. While the interview runs it redrafts a field a moment
 * after its facts change; once the interview is complete it drafts whatever is stale straight away.
 * A field the user edited by hand is never redrafted.
 */
export function useDrafts() {
  const store = useInterviewStore()
  const { session, phase, drafting } = useInterview()
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const warned = useRef(false)

  const key = session
    ? session.fields
        .map((f) => `${f.id}:${factSignature(f)}:${f.draftSig}:${f.edited ? 1 : 0}`)
        .join(";")
    : ""

  useEffect(() => {
    if (!session || (phase !== "interview" && phase !== "complete")) return
    // Scripted drafts match the finished interview, so the replay waits for it instead of showing early ones.
    if (replayMode() && phase === "interview") return
    const active = timers.current

    async function run(id: string) {
      const field = store.getState().session?.fields.find((f) => f.id === id)
      if (!field) return
      const sig = factSignature(field)
      store.dispatch({ type: "drafting", ids: [id], on: true })
      try {
        // The onboarding questions are one short answer each: the facts are the answer, no model needed.
        if (store.getState().session?.source === "onboarding") {
          const text = draftFallback(field)
          store.dispatch({ type: "draft", fieldId: id, text, flags: draftFlags(field, text), sig })
          return
        }
        // The recorded replay has no network: it uses the finished answers written for the script.
        const lang = store.getState().session?.lang === "hi-IN" ? "hi-IN" : "en-IN"
        const scripted = replayMode() ? DEMO_DRAFTS[lang][id] : undefined
        const r = scripted ? { draft: scripted, source: "llm" as const } : await requestDraft(field)
        const current = store.getState().session?.fields.find((f) => f.id === id)
        if (!current || factSignature(current) !== sig || current.edited) return
        if (r.source === "fallback" && !warned.current) {
          warned.current = true
          toast.message("Using plain drafts for now", {
            description: "Add GROQ_API_KEY to .env.local for well-written answers.",
          })
        }
        store.dispatch({ type: "draft", fieldId: id, text: r.draft, flags: draftFlags(current, r.draft), sig })
      } catch {
        const current = store.getState().session?.fields.find((f) => f.id === id)
        if (current && factSignature(current) === sig && !current.edited) {
          const text = draftFallback(current)
          store.dispatch({ type: "draft", fieldId: id, text, flags: draftFlags(current, text), sig })
        }
      } finally {
        store.dispatch({ type: "drafting", ids: [id], on: false })
      }
    }

    for (const f of session.fields) {
      const timer = active.get(f.id)
      if (!needsDraft(f)) {
        if (timer) {
          clearTimeout(timer)
          active.delete(f.id)
        }
        continue
      }
      if (drafting.includes(f.id)) continue
      if (timer) clearTimeout(timer)
      active.set(
        f.id,
        setTimeout(
          () => {
            active.delete(f.id)
            void run(f.id)
          },
          phase === "complete" ? 0 : DEBOUNCE_MS
        )
      )
    }
    // `key` covers every input that matters; `session` itself changes on unrelated updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, phase, drafting.join(",")])

  useEffect(() => {
    const active = timers.current
    return () => active.forEach((t) => clearTimeout(t))
  }, [])
}
