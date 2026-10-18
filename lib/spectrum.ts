export const BANDS = 16

/** Collapse raw 0-255 frequency bins into `n` smooth 0-1 bands. Quiet input stays near zero. */
export function bandsFrom(data: ArrayLike<number>, n = BANDS): number[] {
  const out = new Array<number>(n).fill(0)
  if (!data.length) return out
  const size = data.length / n
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * size)
    const to = Math.max(from + 1, Math.floor((i + 1) * size))
    let sum = 0
    for (let j = from; j < to && j < data.length; j++) sum += data[j]
    // sqrt lifts quiet bands so speech reads clearly without clipping loud ones
    out[i] = Math.min(1, Math.sqrt(sum / (to - from) / 255) * 1.15)
  }
  return out
}

/** A believable moving spectrum for the scripted demo, scaled by how loud the speaker is. */
export function fakeBands(timeMs: number, level: number, n = BANDS): number[] {
  return Array.from({ length: n }, (_, i) => {
    const wave = 0.5 + 0.5 * Math.sin(timeMs / 140 + i * 0.85) * Math.sin(timeMs / 330 + i * 0.4)
    const tilt = 1 - (i / n) * 0.55 // speech has more low-frequency energy
    return Math.min(1, level * (0.35 + 0.9 * wave) * tilt)
  })
}
