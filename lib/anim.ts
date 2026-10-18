import { animate } from "animejs"

export function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/** A quick scale pop. Used when a slot fills or a counter changes. */
export function pop(el: Element | null) {
  if (!el || reducedMotion()) return
  animate(el, {
    scale: [
      { to: 1.14, duration: 160, ease: "outQuad" },
      { to: 1, duration: 380, ease: "outBack" },
    ],
  })
}

/** A short horizontal shake. Used when the guard blocks a quote. */
export function shake(el: Element | null) {
  if (!el || reducedMotion()) return
  animate(el, {
    x: [
      { to: -5, duration: 70 },
      { to: 5, duration: 70 },
      { to: -3, duration: 70 },
      { to: 0, duration: 70 },
    ],
  })
}
