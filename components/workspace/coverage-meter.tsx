"use client"

import { animate } from "animejs"
import { useEffect, useRef } from "react"
import { reducedMotion } from "@/lib/anim"
import { cn } from "@/lib/utils"

/** A big number and a flat bar. Both animate to the new value, like the balance in the reference. */
export function CoverageMeter({ pct, className }: { pct: number; className?: string }) {
  const num = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const shown = useRef(0)

  useEffect(() => {
    const numEl = num.current
    const barEl = bar.current
    if (!numEl || !barEl) return
    const paint = (v: number) => {
      numEl.textContent = String(Math.round(v))
      barEl.style.width = `${v}%`
    }
    if (reducedMotion()) {
      shown.current = pct
      paint(pct)
      return
    }
    const state = { v: shown.current }
    const anim = animate(state, {
      v: pct,
      duration: 900,
      ease: "outExpo",
      onUpdate: () => {
        shown.current = state.v
        paint(state.v)
      },
    })
    return () => {
      anim.pause()
    }
  }, [pct])

  return (
    <div className={cn("w-full", className)} role="img" aria-label={`${pct}% of the questions answered`}>
      <p className="display flex items-baseline text-7xl tabular-nums">
        <span ref={num}>0</span>
        <span className="ml-1 text-3xl opacity-60">%</span>
      </p>
      <div className="mt-3 h-2 bg-foreground/15">
        <div ref={bar} className="h-full w-0 bg-foreground" />
      </div>
    </div>
  )
}
