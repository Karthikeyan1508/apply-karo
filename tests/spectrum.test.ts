import { describe, expect, it } from "vitest"
import { BANDS, bandsFrom, fakeBands } from "@/lib/spectrum"

describe("spectrum", () => {
  it("returns silence for empty or quiet input", () => {
    expect(bandsFrom([])).toEqual(new Array(BANDS).fill(0))
    expect(bandsFrom(new Uint8Array(256)).every((b) => b === 0)).toBe(true)
  })

  it("averages bins into bands and clamps to 1", () => {
    const loud = new Uint8Array(64).fill(255)
    expect(bandsFrom(loud, 4)).toEqual([1, 1, 1, 1])
    const half = Uint8Array.from({ length: 8 }, (_, i) => (i < 4 ? 255 : 0))
    const [a, b] = bandsFrom(half, 2)
    expect(a).toBe(1)
    expect(b).toBe(0)
  })

  it("handles fewer bins than bands", () => {
    expect(bandsFrom([255, 0], 4)).toHaveLength(4)
  })

  it("fake bands stay in range and go quiet at level zero", () => {
    const loud = fakeBands(1234, 1)
    expect(loud).toHaveLength(BANDS)
    expect(loud.every((b) => b >= 0 && b <= 1)).toBe(true)
    expect(fakeBands(1234, 0).every((b) => b === 0)).toBe(true)
  })
})
