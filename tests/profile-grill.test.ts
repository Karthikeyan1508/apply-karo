import { afterEach, describe, expect, it, vi } from "vitest"
import { matchExact, mergeNewest } from "@/lib/core"
import {
  grillSession,
  GRILL_LIMIT,
  validGrillQuestions,
  type GrillQuestion,
} from "@/lib/profile-grill"
import type { ProfileItem, Session } from "@/lib/types"

const project: ProfileItem = {
  label: "Project: Ledger",
  slot: "answer",
  value: "Built a ledger for local shops",
  quote: "Built a ledger for local shops",
  form: "Your profile",
  savedAt: 1,
  key: "project:ledger",
  source: "resume.pdf",
  confirmed: true,
}

const question = {
  subjectKey: "project:ledger",
  label: "A choice in Ledger",
  question:
    "What important choice did you make while building Ledger, and why?",
  category: "decision" as const,
}

function form(): Session {
  return {
    id: "s",
    title: "Form",
    description: "",
    source: "text",
    formUrl: null,
    context: "",
    lang: "en-IN",
    fields: [
      {
        id: "F1",
        index: 0,
        entryId: null,
        label: "Tell us about a project",
        kind: "long_text",
        options: [],
        multi: false,
        required: false,
        intent: "",
        slots: [
          {
            name: "answer",
            ask: "?",
            value: null,
            quote: null,
            skipped: false,
            fromProfile: false,
          },
        ],
        maxChars: null,
        draft: "",
        draftSig: "",
        edited: false,
        flags: [],
      },
    ],
  }
}

describe("profile grill", () => {
  it("keeps only unique questions tied to reviewed projects or experience, capped at six", () => {
    const raw: GrillQuestion[] = Array.from(
      { length: GRILL_LIMIT + 2 },
      (_, i) => ({
        ...question,
        category: (i === 0
          ? "decision"
          : "impact") as GrillQuestion["category"],
        label: `Question ${i}`,
      })
    )
    const valid = validGrillQuestions(
      [...raw, { ...question, subjectKey: "project:made-up" }],
      [project]
    )
    expect(valid).toHaveLength(2)
    expect(valid.map((q) => q.subjectKey)).toEqual([
      "project:ledger",
      "project:ledger",
    ])
  })

  it("creates a compact onboarding session with no source corpus in its context", () => {
    const session = grillSession([question])
    expect(session).toMatchObject({
      source: "onboarding",
      onboardingPurpose: "grill",
      context: "",
    })
    expect(session.fields[0]).toMatchObject({
      label: question.label,
      grill: { subjectKey: "project:ledger", category: "decision" },
    })
  })

  it("replaces a previous decision and never broadly prefills it", () => {
    const old: ProfileItem = {
      ...project,
      label: "Decision: A choice in Ledger",
      value: "Used REST",
      key: "project:ledger:decision",
      kind: "decision",
      subjectKey: "project:ledger",
      category: "decision",
    }
    const next = { ...old, value: "Used an offline queue", savedAt: 2 }
    expect(mergeNewest([old], [next])).toEqual([next])
    expect(matchExact(form(), [next])).toEqual([])
  })
})

describe("profile grill route", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("returns only valid questions when the model returns extra output", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      questions: [
                        question,
                        { ...question, subjectKey: "project:nope" },
                      ],
                    }),
                  },
                },
              ],
            })
          )
      )
    )
    const { POST } = await import("@/app/api/onboard/grill/route")
    const response = await POST(
      new Request("http://localhost/api/onboard/grill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ facts: [project] }),
      })
    )
    expect(response.status).toBe(200)
    expect((await response.json()).questions).toEqual([question])
  })
})
