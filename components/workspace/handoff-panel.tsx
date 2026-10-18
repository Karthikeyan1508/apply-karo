"use client"

import { animate } from "animejs"
import {
  ArrowUpRightIcon,
  ClipboardIcon,
  DownloadIcon,
  PenLineIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAgent } from "@/hooks/use-agent"
import { useInterview, useInterviewStore } from "@/hooks/use-interview"
import { extensionOrigin, useEmbedded } from "@/components/extension-bridge"
import { OnboardingHandoff } from "@/components/profile/onboarding-handoff"
import { reducedMotion } from "@/lib/anim"
import { buildPrefillUrl, exportJson, exportText } from "@/lib/core"
import { fillPayload } from "@/lib/page-form"
import { cn } from "@/lib/utils"
import { PanelHeader } from "./panel-header"
import { TimeSaved } from "./time-saved"

/** Types an answer into its row, as if the form were being filled in front of you. */
function TypedAnswer({ text, delay }: { text: string; delay: number }) {
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reducedMotion()) {
      el.textContent = text
      return
    }
    el.textContent = ""
    const state = { n: 0 }
    const anim = animate(state, {
      n: text.length,
      delay,
      duration: Math.min(1700, 240 + text.length * 14),
      ease: "linear",
      onUpdate: () => {
        el.textContent = text.slice(0, Math.floor(state.n))
      },
      onComplete: () => {
        el.textContent = text
      },
    })
    return () => {
      anim.pause()
    }
  }, [text, delay])

  return <p ref={ref} className="mt-1.5 min-h-6 text-[16px] leading-relaxed font-medium" />
}

/** After approval: the answers go into the form, and the user presses Submit. */
export function HandoffPanel({ className }: { className?: string }) {
  const store = useInterviewStore()
  const agent = useAgent()
  const { session } = useInterview()
  const embedded = useEmbedded()
  useEffect(() => {
    const parent = extensionOrigin()
    if (!parent) return
    function onMessage(e: MessageEvent) {
      if (e.source !== window.parent || e.origin !== parent || e.data?.type !== "bolbharo:filled") return
      const { filled = 0, skipped = [] } = e.data as { filled?: number; skipped?: string[] }
      if (skipped.length) toast.warning(`Filled ${filled}. ${skipped.length} could not be filled: copy those by hand.`)
      else toast.success(`Filled ${filled} ${filled === 1 ? "field" : "fields"}. Check the page, then submit it yourself.`)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  if (!session) return null
  if (session.source === "onboarding") return <OnboardingHandoff className={className} />

  const canFill = session.source === "page" && embedded
  const link = buildPrefillUrl(session)

  function fillPage() {
    const parent = extensionOrigin()
    if (session && parent) window.parent.postMessage({ type: "bolbharo:fill", fields: fillPayload(session) }, parent)
  }
  const rows = session.fields.filter((f) => f.draft.trim())

  async function copy() {
    if (!session) return
    try {
      await navigator.clipboard.writeText(exportText(session))
      toast.success("Answers copied")
    } catch {
      toast.error("Couldn't copy. Use Download instead.")
    }
  }

  function download() {
    if (!session) return
    const blob = new Blob([exportJson(session)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `bolbharo-${session.id}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      <PanelHeader index="02" title="Approved" />

      <div className="shrink-0 px-6 pt-6 pb-4">
        <h2 className="display text-5xl uppercase">
          Ready to <span className="text-brand">send.</span>
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          Nothing has been submitted.{" "}
          {link
            ? "The form opens with every answer filled in. Check it, then press Submit yourself."
            : "Copy the answers into the form, then submit it yourself."}
        </p>
      </div>

      <div className="shrink-0 px-6 pb-4">
        <TimeSaved />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 px-6 pb-5">
          {rows.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[2.5rem_1fr] gap-x-3 rounded-xl border bg-foreground/[0.04] p-5">
              <span className="display text-3xl text-brand tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <p className="label-caps text-muted-foreground">{f.label}</p>
                <TypedAnswer text={f.draft.trim()} delay={i * 450} />
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t p-5">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-10 px-4" onClick={() => store.dispatch({ type: "reopen" })}>
            <PencilIcon /> Back to review
          </Button>
          <Button
            variant="ghost"
            className="h-10 px-4"
            onClick={() => {
              agent.stop()
              store.dispatch({ type: "reset" })
            }}
          >
            <PlusIcon /> New form
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-12 px-5" onClick={download}>
            <DownloadIcon /> JSON
          </Button>
          {canFill && (
            <Button className="h-12 px-7 text-[15px] font-semibold" onClick={fillPage}>
              <PenLineIcon /> Fill this page
            </Button>
          )}
          {link ? (
            <>
              <Button variant="outline" className="h-12 px-5" onClick={copy}>
                <ClipboardIcon /> Copy
              </Button>
              <Button
                className="h-12 px-7 text-[15px] font-semibold"
                onClick={() => window.open(link, "_blank", "noopener,noreferrer")}
              >
                Open the form <ArrowUpRightIcon />
              </Button>
            </>
          ) : (
            <Button className="h-12 px-7 text-[15px] font-semibold" onClick={copy}>
              <ClipboardIcon /> Copy answers
            </Button>
          )}
        </div>
      </footer>
    </section>
  )
}
