"use client"

import { animate } from "animejs"
import { useEffect, useRef } from "react"
import { reducedMotion } from "@/lib/anim"

const ITEMS = [
  "Asks, never reads aloud",
  "Probes vague answers",
  "A quote behind every fact",
  "You press submit",
  "English and हिन्दी",
]

/** A forest strip with lime mono text that scrolls forever. Decorative, so hidden from screen readers. */
export function Ticker() {
  const track = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = track.current
    if (!el || reducedMotion()) return
    const anim = animate(el, { x: ["0%", "-50%"], duration: 40000, ease: "linear", loop: true })
    return () => {
      anim.pause()
    }
  }, [])

  return (
    <div className="overflow-hidden bg-forest py-2.5 text-lime" aria-hidden="true">
      <div ref={track} className="mono-caps flex w-max whitespace-nowrap">
        {[0, 1].map((k) => (
          <div key={k} className="flex shrink-0 items-center gap-10 pr-10">
            {ITEMS.map((item) => (
              <span key={item} className="flex items-center gap-10">
                {item}
                <span className="size-1.5 bg-lime" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
