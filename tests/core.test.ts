import { describe, expect, it } from "vitest"
import {
  applyUpdates,
  coverage,
  fieldStatus,
  norm,
  openSlots,
  planText,
  quoteSupported,
  unsupportedNumbers,
} from "@/lib/core"
import { demoSession } from "@/lib/demo"

describe("quote guard", () => {
  it("normalises punctuation, case and spacing", () => {
    expect(norm("  Hello,   WORLD!! ")).toBe("hello world")
  })

  it("accepts quotes the user said, ignoring punctuation", () => {
    expect(
      quoteSupported("order parsing backend myself, in Python", [
        "I wrote the whole order parsing backend myself in Python.",
      ])
    ).toBe(true)
  })

  it("rejects quotes the user never said", () => {
    expect(quoteSupported("ninety thousand users", ["about thirty shop owners"])).toBe(false)
  })

  it("rejects empty and one-character quotes", () => {
    expect(quoteSupported("", ["anything"])).toBe(false)
    expect(quoteSupported("a", ["a b c"])).toBe(false)
  })

  it("works for Devanagari, including vowel signs", () => {
    expect(quoteSupported("मेरा नाम आशा है", ["नमस्ते, मेरा नाम आशा है।"])).toBe(true)
    expect(quoteSupported("मेरा नाम सीता है", ["नमस्ते, मेरा नाम आशा है।"])).toBe(false)
  })
})

describe("applyUpdates", () => {
  const said = ["Hi I'm Asha Patil based in Pune", "I built a chatbot"]

  it("accepts supported updates and does not mutate the input", () => {
    const s = demoSession()
    const r = applyUpdates(
      s,
      [{ field: "F1", slot: "name", value: "Asha Patil", quote: "Asha Patil" }],
      said
    )
    expect(r.accepted).toHaveLength(1)
    expect(r.rejected).toHaveLength(0)
    expect(r.changedFieldIds).toEqual(["F1"])
    expect(r.session.fields[0].slots[0].value).toBe("Asha Patil")
    expect(s.fields[0].slots[0].value).toBeNull()
  })

  it("rejects invented quotes, missing quotes, empty values and unknown slots", () => {
    const r = applyUpdates(
      demoSession(),
      [
        { field: "F3", slot: "number", value: "90,000", quote: "ninety thousand" },
        { field: "F3", slot: "what", value: "A bot" },
        { field: "F1", slot: "name", value: "  ", quote: "Asha" },
        { field: "F9", slot: "nope", value: "x", quote: "x y" },
      ],
      said
    )
    expect(r.accepted).toHaveLength(0)
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "quote not found in what the user said",
      "missing quote",
      "empty value",
      "unknown slot F9.nope",
    ])
  })

  it("skips only empty slots", () => {
    const first = applyUpdates(
      demoSession(),
      [{ field: "F4", slot: "impact", skip: true }],
      said
    )
    expect(first.session.fields[3].slots[1].skipped).toBe(true)

    const filled = applyUpdates(
      demoSession(),
      [{ field: "F1", slot: "name", value: "Asha", quote: "Asha Patil" }],
      said
    ).session
    const again = applyUpdates(filled, [{ field: "F1", slot: "name", skip: true }], said)
    expect(again.rejected[0].reason).toBe("slot already filled")
  })

  it("lets a later, better answer replace an earlier one", () => {
    const a = applyUpdates(
      demoSession(),
      [{ field: "F3", slot: "what", value: "A chatbot", quote: "I built a chatbot" }],
      said
    ).session
    const b = applyUpdates(
      a,
      [{ field: "F1", slot: "name", value: "Asha Patil", quote: "Asha Patil" }],
      said
    ).session
    expect(b.fields[2].slots[0].value).toBe("A chatbot")
  })
})

describe("coverage and plan", () => {
  it("starts empty and counts skipped slots as handled", () => {
    const s = demoSession()
    expect(coverage(s)).toMatchObject({ total: 14, filled: 0, skipped: 0, pct: 0 })
    const r = applyUpdates(
      s,
      [
        { field: "F1", slot: "name", value: "Asha", quote: "Asha Patil" },
        { field: "F4", slot: "impact", skip: true },
      ],
      ["Asha Patil"]
    ).session
    expect(coverage(r)).toMatchObject({ filled: 1, skipped: 1, open: 12, pct: 14 })
    expect(fieldStatus(r.fields[0])).toBe("complete")
    expect(fieldStatus(r.fields[3])).toBe("partial")
    expect(fieldStatus(r.fields[2])).toBe("empty")
  })

  it("coverage of no session is zero", () => {
    expect(coverage(null).pct).toBe(0)
  })

  it("lists open slots and builds a one-line-per-field plan", () => {
    const s = demoSession()
    expect(openSlots(s)).toHaveLength(14)
    const lines = planText(s).split("\n")
    expect(lines).toHaveLength(6)
    expect(lines[2]).toContain("F3 | Tell us about something you've built")
    expect(lines[2]).toContain('number="Is there a number we can include?"')
  })
})

describe("unsupportedNumbers", () => {
  it("passes numbers present in the facts and flags the rest", () => {
    expect(unsupportedNumbers("Used by 40,000 people.", "40,000 users")).toEqual([])
    expect(unsupportedNumbers("Used by 90,000 people", "40,000 users")).toEqual(["90,000"])
    expect(unsupportedNumbers("No numbers here", "anything")).toEqual([])
  })
})
