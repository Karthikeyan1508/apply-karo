"use client"

import { animate, createScope, stagger } from "animejs"
import { QuoteIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { cn } from "@/lib/utils"

interface Beat {
  agent: string
  you: string
  cards: { slot: string; value: string; quote: string }[]
}

const BEATS: Beat[] = [
  {
    agent: "Tell me about something you've built.",
    you: "It was a WhatsApp ordering bot for kirana stores in Pune.",
    cards: [
      { slot: "What", value: "A WhatsApp ordering bot for kirana stores in Pune", quote: "a WhatsApp ordering bot for kirana stores in Pune" },
    ],
  },
  {
    agent: "Which part did you personally own?",
    you: "I wrote the whole backend myself, in Python.",
    cards: [{ slot: "Own part", value: "Wrote the backend in Python", quote: "I wrote the whole backend myself, in Python" }],
  },
  {
    agent: "Who used it, and what changed?",
    you: "About thirty shop owners. Taking an order went from six minutes to one.",
    cards: [
      { slot: "Users", value: "About 30 shop owners", quote: "About thirty shop owners" },
      { slot: "Outcome", value: "Order time cut from 6 minutes to 1", quote: "went from six minutes to one" },
    ],
  },
  {
    agent: "Is there a number I can put on the form?",
    you: "About four hundred orders a week.",
    cards: [{ slot: "Number", value: "About 400 orders a week", quote: "four hundred orders a week" }],
  },
]

const TOTAL = BEATS.reduce((n, b) => n + b.cards.length, 0)
const STEPS_PER_BEAT = 3

function Waveform() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = root.current
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const scope = createScope({ root: el }).add(() => {
      animate(".wf", {
        scaleY: [0.15, 1],
        duration: 520,
        delay: stagger(38, { from: "center" }),
        alternate: true,
        loop: true,
        ease: "inOutSine",
      })
    })
    return () => scope.revert()
  }, [])
  return (
    <div ref={root} className="flex h-5 items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: 26 }, (_, i) => (
        <span key={i} className="wf h-full w-[2px] origin-center bg-brand" />
      ))}
    </div>
  )
}

/** A looping miniature of the product: what you say on the left, what it captures on the right. */
export function LiveDemo() {
  const reduced = useReducedMotion()
  const loop = BEATS.length * STEPS_PER_BEAT + 3
  const [t, setT] = useState(0)

  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setT((v) => (v + 1) % loop), 1250)
    return () => clearInterval(id)
  }, [reduced, loop])

  const tick = reduced ? loop : t
  const shown = BEATS.map((b, i) => ({
    b,
    agent: tick >= i * STEPS_PER_BEAT,
    you: tick >= i * STEPS_PER_BEAT + 1,
    cards: tick >= i * STEPS_PER_BEAT + 2,
  }))
  const facts = shown.reduce((n, s) => n + (s.cards ? s.b.cards.length : 0), 0)

  return (
    <div className="panel grid min-h-[28rem] overflow-hidden rounded-xl lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col border-b p-6 lg:border-r lg:border-b-0">
        <div className="label-caps flex items-center justify-between text-muted-foreground">
          <span>
            <span className="mono-caps font-semibold text-brand">01</span>
            <span className="mx-2 opacity-40">/</span>You say
          </span>
          <Waveform />
        </div>
        <ul className="mt-6 flex flex-1 flex-col gap-5">
          {shown.map(
            (s, i) =>
              s.agent && (
                <li key={i} className="animate-in flex flex-col gap-2 duration-500 fade-in slide-in-from-bottom-1">
                  <p className="text-sm text-muted-foreground">
                    <span className="label-caps mr-2 text-foreground">Apply करो</span>
                    {s.b.agent}
                  </p>
                  {s.you && (
                    <p
                      className={cn(
                        "animate-in self-start bg-brand px-3 py-2 text-[15px] leading-snug font-medium text-brand-foreground duration-500 fade-in slide-in-from-left-2"
                      )}
                    >
                      {s.b.you}
                    </p>
                  )}
                </li>
              )
          )}
        </ul>
      </div>

      <div className="flex flex-col p-6">
        <div className="label-caps flex items-center justify-between text-muted-foreground">
          <span>
            <span className="mono-caps font-semibold text-brand">02</span>
            <span className="mx-2 opacity-40">/</span>It captures
          </span>
          <span>Every fact keeps your words</span>
        </div>
        <p className="display mt-4 flex items-baseline text-8xl text-brand tabular-nums">
          {facts}
          <span className="ml-2 text-4xl text-muted-foreground">/{TOTAL}</span>
        </p>
        <ul className="mt-5 flex flex-col gap-2">
          {shown.flatMap((s) =>
            s.cards
              ? s.b.cards.map((c) => (
                  <li
                    key={c.slot}
                    className="animate-in rounded-lg border border-l-[3px] border-l-brand bg-foreground/[0.04] p-3 duration-500 fade-in slide-in-from-bottom-1"
                  >
                    <p className="label-caps text-brand">{c.slot}</p>
                    <p className="mt-0.5 text-[14px] leading-snug font-semibold">{c.value}</p>
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <QuoteIcon className="mt-0.5 size-3 shrink-0 text-brand" />
                      <span>{c.quote}</span>
                    </p>
                  </li>
                ))
              : []
          )}
        </ul>
      </div>
    </div>
  )
}
