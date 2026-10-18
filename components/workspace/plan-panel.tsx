"use client"

import { animate, createScope, stagger } from "animejs"
import { CheckIcon } from "lucide-react"
import { useEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useInterview } from "@/hooks/use-interview"
import { reducedMotion } from "@/lib/anim"
import { coverage, fieldStatus } from "@/lib/core"
import type { SessionSource } from "@/lib/types"
import { cn } from "@/lib/utils"
import { CoverageMeter } from "./coverage-meter"
import { PanelHeader } from "./panel-header"
import { SlotChip } from "./slot-chip"
import { StrengthMeter } from "./strength-meter"

const SOURCE_LABEL: Record<SessionSource, string> = {
  google: "Google Form",
  text: "Pasted form",
  demo: "Demo form",
  page: "Web page",
  onboarding: "Your profile",
}

/** The interview plan: a big live number, then every question with the facts it needs. */
export function PlanPanel({ className }: { className?: string }) {
  const { session, lastFieldId } = useInterview()
  const list = useRef<HTMLDivElement>(null)
  const cards = useRef(new Map<string, HTMLDivElement>())
  const sessionId = session?.id

  useEffect(() => {
    if (!list.current || reducedMotion()) return
    const scope = createScope({ root: list.current }).add(() => {
      animate(".field-card", {
        opacity: [0, 1],
        x: [-14, 0],
        delay: stagger(55),
        duration: 480,
        ease: "outCubic",
      })
    })
    return () => scope.revert()
  }, [sessionId])

  useEffect(() => {
    if (lastFieldId) {
      cards.current.get(lastFieldId)?.scrollIntoView({
        block: "nearest",
        behavior: reducedMotion() ? "auto" : "smooth",
      })
    }
  }, [lastFieldId])

  if (!session) return null
  const cov = coverage(session)

  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      <PanelHeader index="01" title="Plan" right={SOURCE_LABEL[session.source]} />

      <div className="block-lime mx-4 mt-4 shrink-0 rounded-xl p-5">
        <p className="label-caps line-clamp-2 text-muted-foreground">{session.title}</p>
        <CoverageMeter pct={cov.pct} className="mt-4" />
        <p className="mono-caps mt-4 tabular-nums">
          {cov.filled} captured
          {cov.pending > 0 && ` · ${cov.pending} to confirm`}
          {cov.skipped > 0 && ` · ${cov.skipped} skipped`} · {cov.open} to go
        </p>
      </div>

      <ScrollArea className="mt-3 min-h-0 flex-1">
        <div ref={list} className="flex flex-col gap-2 px-4 pb-4">
          {session.fields.map((f, i) => {
            const status = fieldStatus(f)
            const active = f.id === lastFieldId
            return (
              <div
                key={f.id}
                ref={(el) => {
                  if (el) cards.current.set(f.id, el)
                  else cards.current.delete(f.id)
                }}
                className={cn(
                  "field-card rounded-xl border border-l-[3px] bg-foreground/[0.04] p-3.5 transition-colors duration-500",
                  active ? "border-l-brand bg-brand/10" : "border-l-transparent"
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="label-caps mt-0.5 w-5 shrink-0 text-muted-foreground tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="min-w-0 flex-1 text-[13px] leading-snug font-semibold">
                    {f.label}
                    {f.required && (
                      <span className="ml-1 text-muted-foreground" title="Required">
                        *
                      </span>
                    )}
                  </p>
                  <span
                    className={cn(
                      "mt-0.5 grid size-4 shrink-0 place-items-center rounded-[2px] border transition-colors",
                      status === "complete"
                        ? "border-transparent bg-brand text-brand-foreground"
                        : status === "partial"
                          ? "border-brand bg-brand/25"
                          : "border-foreground/30"
                    )}
                  >
                    {status === "complete" && <CheckIcon className="size-3" strokeWidth={3} />}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5 pl-8">
                  {f.slots.map((s) => (
                    <SlotChip key={s.name} slot={s} />
                  ))}
                </div>
                <StrengthMeter field={f} className="mt-2.5 pl-8" />
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </section>
  )
}
