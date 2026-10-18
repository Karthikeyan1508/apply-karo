import { afterEach, describe, expect, it, vi } from "vitest"
import { applyPrefill, derivedValue, matchExact } from "@/lib/core"
import { demoSession } from "@/lib/demo"
import { findGaps } from "@/lib/profile-gaps"
import { groundFacts } from "@/lib/profile-ground"
import { keyOf } from "@/lib/profile-keys"
import { patternFacts } from "@/lib/profile-patterns"
import { prefillMatches } from "@/lib/profile"
import { checkReadiness } from "@/lib/readiness"
import type { ProfileItem, Session } from "@/lib/types"

const RESUME = `Karthikeyan Tamilselvan
Bengaluru, Karnataka
+91 98765 43210 | karthikeyan@example.com | linkedin.com/in/karthikeyan-t | github.com/Karthikeyan1508

EDUCATION
UVCE, Bangalore University - B.Tech in Computer Science, 2025. CGPA 8.4
`

describe("details found by pattern", () => {
  const facts = patternFacts([{ name: "resume.pdf", text: RESUME }])
  const by = Object.fromEntries(facts.map((f) => [f.key, f]))

  it("finds the contact details and links, each quoted exactly as written", () => {
    expect(by.email).toMatchObject({
      value: "karthikeyan@example.com",
      quote: "karthikeyan@example.com",
    })
    expect(by.phone.value).toBe("+91 98765 43210")
    expect(by.linkedin).toMatchObject({
      value: "https://linkedin.com/in/karthikeyan-t",
      quote: "linkedin.com/in/karthikeyan-t",
    })
    expect(by.github).toMatchObject({
      value: "https://github.com/Karthikeyan1508",
      quote: "github.com/Karthikeyan1508",
    })
  })

  it("takes the name from the top of the resume", () => {
    expect(by.full_name.value).toBe("Karthikeyan Tamilselvan")
  })

  it("passes the same quote check as everything else", () => {
    const grounded = groundFacts(facts, [{ name: "resume.pdf", text: RESUME }])
    expect(grounded.map((g) => g.key).sort()).toEqual([
      "email",
      "full_name",
      "github",
      "linkedin",
      "phone",
    ])
  })

  it("does not take a year, a pincode or a heading for a phone or a name", () => {
    const f = patternFacts([
      {
        name: "r",
        text: "Curriculum Vitae\nSkills\nPincode 560056, graduated 2025\n",
      },
    ])
    expect(f).toEqual([])
  })

  it("reads labelled lines from GitHub and pasted LinkedIn text", () => {
    const f = patternFacts([
      {
        name: "github",
        text: "GitHub profile: https://github.com/asha\nName: Asha Patil\nLocation: Pune, India\nPublic email: asha@x.com",
      },
    ])
    const k = Object.fromEntries(f.map((x) => [x.key, x]))
    expect(k.full_name.value).toBe("Asha Patil")
    expect(k.city.value).toBe("Pune, India")
    expect(k.email.value).toBe("asha@x.com")
  })

  it("takes a LinkedIn export's name below its contact block", () => {
    const f = patternFacts([
      {
        name: "linkedin",
        text: "Contact\n+91 99999 88888 (Mobile)\nasha@x.com\nTop Skills\nPython\nAsha Patil\nBackend Engineer at Acme\n",
      },
    ])
    expect(f.find((x) => x.key === "full_name")?.value).toBe("Asha Patil")
  })
})

describe("recognising what a question asks for", () => {
  it.each([
    ["Name", "full_name"],
    ["Candidate Name", "full_name"],
    ["Mobile No.", "phone"],
    ["WhatsApp number", "phone"],
    ["WhatsApp No", "phone"],
    ["Email ID", "email"],
    ["Current Location", "city"],
    ["Institute", "college"],
    ["Branch", "branch"],
    ["CGPA", "cgpa"],
    ["Passing Year", "graduation_year"],
    ["Total experience", "years_experience"],
  ])("%s asks for %s", (label, key) => {
    expect(keyOf(label)).toBe(key)
  })

  it.each(["Preferred job location", "Company name", "Father's name"])(
    "%s is not one of the person's own details",
    (label) => {
      expect(["full_name", "city"].includes(keyOf(label) ?? "")).toBe(false)
    }
  )

  it("is never asked about branch or CGPA in the interview", () => {
    const keys = findGaps([]).map((g) => g.key)
    expect(keys).not.toContain("branch")
    expect(keys).not.toContain("cgpa")
  })
})

const fact = (
  label: string,
  value: string,
  key?: string,
  over: Partial<ProfileItem> = {}
): ProfileItem => ({
  label,
  slot: "answer",
  value,
  quote: value,
  form: "Your profile",
  savedAt: 1,
  confirmed: true,
  ...(key ? { key } : {}),
  ...over,
})

const form = (labels: string[]): Session => {
  const s = demoSession("en-IN")
  return {
    ...s,
    source: "page",
    fields: labels.map((label, i) => ({
      ...s.fields[0],
      id: `F${i + 1}`,
      label,
      entryId: `0:b${i + 1}`,
      slots: [
        {
          name: "answer",
          ask: label,
          value: null,
          quote: null,
          skipped: false,
          fromProfile: false,
        },
      ],
    })),
  }
}

describe("a value taken from part of a fact", () => {
  const name = fact("Full name", "Karthikeyan Tamilselvan", "full_name")

  it("is allowed only when everything in it is in the fact", () => {
    expect(derivedValue(name, "Karthikeyan")).toBe("Karthikeyan")
    expect(derivedValue(name, "Tamilselvan")).toBe("Tamilselvan")
    expect(derivedValue(name, "karthikeyan tamilselvan")).toBe(
      "Karthikeyan Tamilselvan"
    )
    expect(derivedValue(name, "Karthik")).toBe("Karthik")
    expect(derivedValue(name, "Karthikeyan Kumar")).toBeNull()
    expect(derivedValue(name, "")).toBeNull()
  })

  it("accepts the digits of a phone number written another way, and nothing else", () => {
    const phone = fact("Phone number", "+91 98765 43210", "phone")
    expect(derivedValue(phone, "9876543210")).toBe("9876543210")
    expect(derivedValue(phone, "9876543211")).toBeNull()
  })

  it("fills a first name and a last name from the full name with no model", () => {
    const s = form([
      "First Name",
      "Last Name",
      "Company name",
      "Guardian's last name",
    ])
    const fills = matchExact(s, [name])
    const got = Object.fromEntries(fills.map((f) => [f.fieldId, f.item.value]))
    expect(got).toEqual({ F1: "Karthikeyan", F2: "Tamilselvan" })
  })

  it("does not split a one-word name into a last name", () => {
    expect(
      matchExact(form(["Last name"]), [
        fact("Full name", "Karthikeyan", "full_name"),
      ])
    ).toEqual([])
  })
})

describe("matching with the model", () => {
  afterEach(() => vi.unstubAllGlobals())
  const saved = [
    fact("Full name", "Karthikeyan Tamilselvan", "full_name"),
    fact("College or university", "UVCE, Bangalore University", "college"),
  ]

  it("uses a part of a fact when that is what the question asks, and one fact for several questions", async () => {
    const s = form([
      "What should we call you",
      "Family line",
      "Where did you study",
    ])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          fills: [
            { field: "F1", slot: "answer", saved: 0, value: "Karthikeyan" },
            { field: "F2", slot: "answer", saved: 0, value: "Tamilselvan" },
            {
              field: "F3",
              slot: "answer",
              saved: 1,
              value: "UVCE, Bangalore University",
            },
          ],
        })
      )
    )
    const fills = await prefillMatches(s, saved)
    const filled = applyPrefill(s, fills)
    expect(filled.fields.map((f) => f.slots[0].value)).toEqual([
      "Karthikeyan",
      "Tamilselvan",
      "UVCE, Bangalore University",
    ])
    // The quote is still the fact's own words.
    expect(filled.fields[0].slots[0].quote).toBe("Karthikeyan Tamilselvan")
  })

  it("refuses a value that holds anything the fact does not", async () => {
    const s = form(["What should we call you"])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          fills: [
            {
              field: "F1",
              slot: "answer",
              saved: 0,
              value: "Karthikeyan Kumar",
            },
          ],
        })
      )
    )
    expect(await prefillMatches(s, saved)).toEqual([])
  })

  it("ignores a fact number or a slot the model made up", async () => {
    const s = form(["What should we call you"])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          fills: [
            { field: "F1", slot: "answer", saved: 99, value: "x" },
            { field: "F9", slot: "answer", saved: 0, value: "Karthikeyan" },
          ],
        })
      )
    )
    expect(await prefillMatches(s, saved)).toEqual([])
  })

  it("sends the keys, so the model can tell what each fact is", async () => {
    const s = form(["Mobile"])
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      void init
      return Response.json({ fills: [] })
    })
    vi.stubGlobal("fetch", f)
    await prefillMatches(s, [fact("Phone number", "+91 98765 43210", "phone")])
    // "Mobile" matches the phone fact for free, so the model is not even asked.
    expect(f).not.toHaveBeenCalled()
    await prefillMatches(form(["Reach me at"]), [
      fact("Phone number", "+91 98765 43210", "phone"),
    ])
    const sent = JSON.parse(
      (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    )
    expect(sent.saved[0]).toMatchObject({
      key: "phone",
      value: "+91 98765 43210",
    })
  })
})

describe("readiness for questions the profile already answered", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("is not asked about, so a filled question is never held back", async () => {
    const f = vi.fn()
    vi.stubGlobal("fetch", f)
    const s = form(["Name"])
    s.fields[0].slots[0].value = "Karthikeyan"
    expect(await checkReadiness(s, [])).toBe(s)
    expect(f).not.toHaveBeenCalled()
  })
})

describe("a label that only mentions WhatsApp", () => {
  it("is not a phone number", () => {
    expect(keyOf("Agent link — must open without signup (WhatsApp, web link or app)")).not.toBe("phone")
  })
})
