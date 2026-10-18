"use client"

import { CheckIcon, QuoteIcon, XIcon } from "lucide-react"
import { useEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useInterview } from "@/hooks/use-interview"
import { pop, shake } from "@/lib/anim"
import { coverage } from "@/lib/core"
import type { GuardEvent, Session } from "@/lib/types"
import { cn } from "@/lib/utils"
import { PanelHeader } from "./panel-header"
import { slotLabel } from "./slot-chip"

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center px-8 py-16 text-center text-sm text-muted-foreground">
      <p className="max-w-56 text-balance">{children}</p>
    </div>
  )
}

function GuardRow({ event, session }: { event: GuardEvent; session: Session }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!event.accepted) shake(ref.current)
  }, [event.accepted])

  const field = session.fields.find((f) => f.id === event.update.field)
  const what = `${field?.label ?? event.update.field}, ${slotLabel(event.update.slot).toLowerCase()}`

  return (
    <div
      ref={ref}
      className={cn(
        "animate-in rounded-xl border border-l-[3px] p-3 text-[13px] duration-300 fade-in slide-in-from-top-1",
        event.accepted
          ? "border-l-brand bg-foreground/[0.04]"
          : "border-destructive/40 border-l-destructive bg-destructive/10"
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded-[2px]",
            event.accepted ? "bg-brand text-brand-foreground" : "bg-destructive text-white"
          )}
        >
          {event.accepted ? (
            <CheckIcon className="size-3" strokeWidth={3} />
          ) : (
            <XIcon className="size-3" strokeWidth={3} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">{what}</span>
        <span className={cn("label-caps shrink-0", event.accepted ? "text-muted-foreground" : "text-destructive")}>
          {event.accepted ? (event.update.skip ? "skipped" : "saved") : "blocked"}
        </span>
      </div>
      {event.update.quote && (
        <p
          className={cn(
            "mt-2 flex items-start gap-1.5 pl-[26px] text-xs text-muted-foreground",
            !event.accepted && "line-through decoration-destructive/60"
          )}
        >
          <QuoteIcon className="mt-0.5 size-3 shrink-0" />
          <span>{event.update.quote}</span>
        </p>
      )}
      {event.reason && <p className="mt-1 pl-[26px] text-xs font-medium text-destructive">{event.reason}</p>}
    </div>
  )
}

/** Evidence ledger: every captured fact beside the words that back it, and the guard's decisions. */
export function FactsPanel({ className }: { className?: string }) {
  const { session, guardLog } = useInterview()
  const blockedRef = useRef<HTMLSpanElement>(null)
  const savedRef = useRef<HTMLSpanElement>(null)

  const captured = coverage(session).filled
  const blocked = guardLog.filter((g) => !g.accepted).length

  useEffect(() => {
    pop(savedRef.current)
  }, [captured])
  useEffect(() => {
    pop(blockedRef.current)
  }, [blocked])

  if (!session) return null
  const withFacts = session.fields
    .map((f) => ({ f, slots: f.slots.filter((s) => s.value !== null) }))
    .filter((x) => x.slots.length)

  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      <PanelHeader
        index="03"
        title="Evidence"
        right={<span className="hidden xl:inline">Your words, beside every fact</span>}
      />
      <Tabs defaultValue="facts" className="min-h-0 flex-1 gap-0">
        <div className="p-4 pb-3">
          <TabsList className="h-10 w-full">
            <TabsTrigger value="facts">
              Facts
              <span ref={savedRef} className="label-caps opacity-70 tabular-nums">
                {captured}
              </span>
            </TabsTrigger>
            <TabsTrigger value="guard">
              Guard
              <span
                ref={blockedRef}
                className={cn("label-caps tabular-nums", blocked ? "font-bold text-destructive" : "opacity-70")}
              >
                {blocked} blocked
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="facts" className="min-h-0">
          <ScrollArea className="h-full">
            {withFacts.length === 0 ? (
              <Empty>Facts appear here as you speak, each beside your exact words.</Empty>
            ) : (
              <div className="flex flex-col gap-5 px-4 pb-4">
                {withFacts.map(({ f, slots }) => (
                  <div key={f.id}>
                    <h3 className="label-caps mb-2 text-muted-foreground">{f.label}</h3>
                    <ul className="flex flex-col gap-2">
                      {slots.map((s) => (
                        <li
                          key={s.name}
                          className="animate-in rounded-xl border border-l-[3px] border-l-brand bg-foreground/[0.04] p-3 duration-500 fade-in slide-in-from-bottom-1"
                        >
                          <p className="label-caps text-brand">
                            {slotLabel(s.name)}
                            {(s.source || s.fromProfile) && (
                              <span className="ml-2 font-normal text-muted-foreground">
                                from {s.source ?? "an earlier form"}
                              </span>
                            )}
                          </p>
                          <p className="mt-1 text-[14px] leading-snug font-semibold">{s.value}</p>
                          {s.quote && (
                            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                              <QuoteIcon className="mt-0.5 size-3 shrink-0 text-brand" />
                              <span>{s.quote}</span>
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="guard" className="min-h-0">
          <ScrollArea className="h-full">
            {guardLog.length === 0 ? (
              <Empty>Every fact needs a quote you actually said. Anything else is blocked here.</Empty>
            ) : (
              <div className="flex flex-col gap-2 px-4 pb-4">
                {[...guardLog].reverse().map((g) => (
                  <GuardRow key={g.id} event={g} session={session} />
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </section>
  )
}
