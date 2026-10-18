import { afterEach, describe, expect, it, vi } from "vitest"
import { demoSession } from "@/lib/demo"
import { readSources } from "@/lib/onboard-client"
import { autofillPayload } from "@/lib/page-form"
import { shown } from "@/lib/profile"
import type { ProfileItem, Session, Slot } from "@/lib/types"

const field = (id: string, ref: string | null, slots: Partial<Slot>[]) => ({
  ...demoSession("en-IN").fields[0],
  id,
  entryId: ref,
  slots: slots.map((s, i) => ({ name: `s${i}`, ask: "?", value: null, quote: null, skipped: false, ...s })) as Slot[],
})

describe("what Autofill types into the page", () => {
  const base = demoSession("en-IN")
  const session = (fields: ReturnType<typeof field>[]): Session => ({ ...base, fields })

  it("takes single-question fields the profile fully answered", () => {
    const s = session([field("F1", "0:b1", [{ value: " Asha Patil ", quote: "Asha Patil" }])])
    expect(autofillPayload(s)).toEqual([{ ref: "0:b1", value: "Asha Patil" }])
  })

  it("leaves out facts still waiting for a yes, empty answers, fields it cannot find again, and multi-part answers", () => {
    const s = session([
      field("F1", "0:b1", [{ value: "15 LPA", quote: "15 LPA", fromProfile: true }]),
      field("F2", "0:b2", [{ value: null }]),
      field("F3", null, [{ value: "x", quote: "x" }]),
      field("F4", "0:b4", [
        { value: "a", quote: "a" },
        { value: "b", quote: "b" },
      ]),
      field("F5", "0:b5", [{ value: "   ", quote: "q" }]),
    ])
    expect(autofillPayload(s)).toEqual([])
  })
})

describe("what the resume gave", () => {
  const item = (label: string, hidden?: boolean): ProfileItem => ({ label, slot: "answer", value: "v", quote: "q", form: "f", savedAt: 1, ...(hidden ? { hidden } : {}) })

  it("is kept out of the list the person sees", () => {
    expect(shown([item("a"), item("b", true), item("c")]).map((f) => f.label)).toEqual(["a", "c"])
  })

  describe("when sources are read", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("marks facts from the resume hidden and leaves links and other sources visible", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            facts: [
              { key: "full_name", label: "Full name", value: "Asha Patil", quote: "Asha Patil", source: "resume.pdf" },
              { key: "current_company", label: "Current company", value: "Acme", quote: "Engineer at Acme", source: "linkedin" },
            ],
            truncated: false,
          })
        )
      )
      const out = await readSources(
        {
          resume: { name: "resume.pdf", text: "Asha Patil. Product engineer." },
          linkedin: { name: "profile.pdf", text: "Engineer at Acme since 2023." },
          github: "",
          linkedinUrl: "https://www.linkedin.com/in/asha",
        },
        () => {}
      )
      const by = Object.fromEntries(out.facts.map((f) => [f.key, f]))
      expect(by.full_name.hidden).toBe(true)
      expect(by.current_company.hidden).toBeUndefined()
      expect(by.linkedin.hidden).toBeUndefined()
    })
  })
})
