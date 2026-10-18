"use client"

import {
  ArrowRightIcon,
  ChevronDownIcon,
  QuoteIcon,
  SquareIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useAgent } from "@/hooks/use-agent"
import { useInterview, useInterviewStore } from "@/hooks/use-interview"
import { useSyncing } from "@/hooks/use-auth"
import { useProfileCount } from "@/hooks/use-profile-count"
import { confirmedFacts, missingRequired } from "@/lib/core"
import { rewriteField } from "@/lib/draft-client"
import { recordForm } from "@/lib/history-client"
import { forgetProfile, pushProfile, saveOnboardingAnswers, saveProfile, syncEnabled } from "@/lib/profile"
import { sourceLabel } from "@/components/profile/fact-card"
import type { FormField } from "@/lib/types"
import { cn } from "@/lib/utils"
import { PanelHeader } from "./panel-header"
import { slotLabel } from "./slot-chip"
import { StrengthMeter } from "./strength-meter"

function Lines() {
  return (
    <div className="mt-3 flex flex-col gap-2" aria-label="Writing the answer">
      <div className="shimmer h-4 w-full" />
      <div className="shimmer h-4 w-11/12" />
      <div className="shimmer h-4 w-2/3" />
    </div>
  )
}

function ChoicePicker({ field, onPick }: { field: FormField; onPick: (text: string) => void }) {
  const selected = field.options.filter((o) => field.draft.includes(o))
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {field.options.map((o) => {
        const on = selected.includes(o)
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (!field.multi) return onPick(o)
              onPick((on ? selected.filter((s) => s !== o) : [...selected, o]).join(", "))
            }}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
              on ? "border-transparent bg-brand text-brand-foreground" : "hover:bg-foreground/[0.06]"
            )}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

function AnswerCard({ field, index, writing }: { field: FormField; index: number; writing: boolean }) {
  const store = useInterviewStore()
  const [open, setOpen] = useState(false)
  const [ask, setAsk] = useState("")
  const [busy, setBusy] = useState(false)
  const facts = confirmedFacts(field)
  const over = field.maxChars !== null && field.draft.length > field.maxChars

  async function rewrite(e: React.FormEvent) {
    e.preventDefault()
    const instruction = ask.trim()
    if (!instruction || busy) return
    setBusy(true)
    const r = await rewriteField(store, field.id, instruction)
    setBusy(false)
    if ("text" in r) return setAsk("")
    toast.error(r.error === "no_llm" ? "Rewrites need a Groq key" : "Couldn't rewrite that", {
      description:
        r.error === "no_llm"
          ? "Add GROQ_API_KEY to .env.local. You can still edit the text by hand."
          : "Try again, or edit the text by hand.",
    })
  }

  return (
    <article className="grid grid-cols-[2.5rem_1fr] gap-x-3 rounded-xl border border-l-[3px] border-l-brand bg-foreground/[0.04] p-5">
      <span className="display text-3xl text-brand tabular-nums">{String(index + 1).padStart(2, "0")}</span>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[13px] leading-snug font-semibold text-muted-foreground">
            {field.label}
            {field.required && <span className="ml-1">*</span>}
          </h3>
          <span className="label-caps shrink-0 text-brand">{writing ? "Writing" : field.edited ? "Edited" : ""}</span>
        </div>
        <StrengthMeter field={field} className="mt-2" />

        {field.kind === "choice" && field.options.length > 0 ? (
          <ChoicePicker field={field} onPick={(text) => store.dispatch({ type: "edit", fieldId: field.id, text })} />
        ) : writing && !field.draft ? (
          <Lines />
        ) : (
          <Textarea
            value={field.draft}
            onChange={(e) => store.dispatch({ type: "edit", fieldId: field.id, text: e.target.value })}
            aria-label={`Answer to: ${field.label}`}
            className="mt-2 min-h-0 resize-none rounded-none border-0 bg-transparent p-0 text-[16px] leading-relaxed font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        )}

        {field.flags.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {field.flags.map((f) => (
              <li key={f} className="flex items-start gap-2 text-xs font-medium text-destructive">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="label-caps inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            Based on {facts.length} {facts.length === 1 ? "fact" : "facts"}
            <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
          {field.maxChars !== null && (
            <span className={cn("mono-caps tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
              {field.draft.length}/{field.maxChars}
            </span>
          )}
        </div>

        {open && (
          <ul className="animate-in mt-3 flex flex-col gap-2 duration-300 fade-in slide-in-from-top-1">
            {facts.map((x) => (
              <li key={x.slot} className="rounded-lg bg-foreground/[0.06] p-3 text-xs">
                <p className="label-caps text-brand">{slotLabel(x.slot)}</p>
                <p className="mt-1 text-[13px] font-semibold">{x.value}</p>
                {x.source && <p className="label-caps mt-1 text-muted-foreground">From {sourceLabel(x.source)}</p>}
                {x.quote && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-muted-foreground">
                    <QuoteIcon className="mt-0.5 size-3 shrink-0 text-brand" />
                    <span>{x.quote}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {field.kind !== "choice" && (
          <form onSubmit={rewrite} className="mt-4 flex gap-2">
            <Input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="Ask for a change: make it shorter"
              aria-label="Ask for a rewrite"
              className="h-10 px-3 text-[13px]"
              disabled={busy}
            />
            <Button type="submit" variant="outline" className="h-10 px-4" disabled={!ask.trim() || busy}>
              <WandSparklesIcon /> Rewrite
            </Button>
          </form>
        )}
      </div>
    </article>
  )
}

/** Review: every drafted answer, editable, beside the words it came from. Approving hands over. */
export function ReviewPanel({ className }: { className?: string }) {
  const store = useInterviewStore()
  const agent = useAgent()
  const { session, drafting } = useInterview()
  const saved = useProfileCount()
  const syncing = useSyncing()
  // In the side panel the point is reuse, so facts are remembered unless the person turns it off.
  const [remember, setRemember] = useState(() => typeof window !== "undefined" && window.parent !== window)

  if (!session) return null
  const missing = missingRequired(session)
  const writing = drafting.length > 0
  const blocked = missing.length > 0 || writing
  const voiceOn = agent.status === "live" && agent.channel !== "demo"

  function approve() {
    // The onboarding interview is for the profile itself: its answers are saved on approval.
    if (session?.source === "onboarding") {
      const n = saveOnboardingAnswers(session)
      if (n === null) {
        toast.error("Couldn't save", { description: "This browser is blocking storage." })
        return
      }
      if (syncEnabled()) void pushProfile()
      store.dispatch({ type: "approve" })
      return
    }
    if (remember && session) {
      const n = saveProfile(session)
      const sync = syncing
      if (n) toast.success(`Saved ${n} ${n === 1 ? "fact" : "facts"} on this device${sync ? " and in your account" : ""}`)
      if (n && sync) {
        void pushProfile().then((ok) => ok || toast.warning("Couldn't reach your account. The facts are saved on this device."))
      }
    }
    // Every form the person approves is kept for the dashboard, whether or not they remember its facts.
    if (session) void recordForm(session)
    store.dispatch({ type: "approve" })
  }

  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      <PanelHeader
        index="02"
        title="Review"
        right={
          agent.status === "live" ? (
            <button
              type="button"
              onClick={agent.stop}
              className="inline-flex items-center gap-1.5 text-foreground underline underline-offset-4"
            >
              <SquareIcon className="size-3" /> End call
            </button>
          ) : undefined
        }
      />

      <div className="shrink-0 px-6 pt-6 pb-4">
        <h2 className="display text-5xl uppercase">
          Check every <span className="text-brand">line.</span>
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          Each answer is written only from what you said. Edit the text, or ask for a rewrite
          {voiceOn ? ", or just tell me out loud" : ""}.
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-6 pb-5">
          {session.fields.map((f, i) => (
            <AnswerCard key={f.id} field={f} index={i} writing={drafting.includes(f.id)} />
          ))}
        </div>
      </ScrollArea>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t p-5">
        <div className="flex flex-col gap-1.5">
          {session.source !== "onboarding" && (
            <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium">
              <Switch
                checked={remember}
                onCheckedChange={setRemember}
                aria-label="Remember my facts"
                className="rounded-[3px] **:data-[slot=switch-thumb]:rounded-[2px]"
              />
              Remember my facts on this device{syncing ? " and in my account" : ""}
            </label>
          )}
          {saved > 0 && (
            <button
              type="button"
              className="text-left text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => {
                void forgetProfile()
                toast.success("Saved facts deleted")
              }}
            >
              Forget the {saved} saved
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {blocked && (
            <span className="label-caps text-muted-foreground">
              {writing
                ? "Still writing…"
                : `${missing.length} required ${missing.length === 1 ? "answer is" : "answers are"} empty`}
            </span>
          )}
          <Button className="h-12 px-7 text-[15px] font-semibold" disabled={blocked} onClick={approve}>
            Approve <ArrowRightIcon />
          </Button>
        </div>
      </footer>
    </section>
  )
}
