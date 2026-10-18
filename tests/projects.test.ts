import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyPrefill, openSlots } from "@/lib/core"
import { demoSession } from "@/lib/demo"
import { createInterviewStore } from "@/lib/interview-store"
import { autofillPayload } from "@/lib/page-form"
import { isProjectQuestion, rankRepos, type Repo } from "@/lib/repos"
import type { Session } from "@/lib/types"

const repo = (name: string, over: Partial<Repo> = {}): Repo => ({
  name,
  full: `asha/${name}`,
  url: `https://github.com/asha/${name}`,
  description: "",
  language: "",
  topics: [],
  stars: 0,
  pushed: "2026-01-01T00:00:00Z",
  private: false,
  fork: false,
  ...over,
})

describe("a question about projects", () => {
  it.each([
    "Please describe one or two projects you have worked on.",
    "Tell us about something you've built",
    "Describe a project you developed",
    "Side projects",
  ])("%s is one", (label) => {
    expect(isProjectQuestion({ label, kind: "long_text" })).toBe(true)
  })

  it.each([
    "What is your full name?",
    "Why do you want to join us?",
    "Project manager experience in years",
  ])("%s is not", (label) => {
    // "Project manager..." mentions a project, but as a job title on a number question.
    expect(
      isProjectQuestion({
        label,
        kind: label.startsWith("Project") ? "number" : "text",
      })
    ).toBe(false)
  })

  it("reads the form's own wording about what it wants as well as its label", () => {
    expect(
      isProjectQuestion({
        label: "Experience",
        intent: "Describe the projects you worked on",
        kind: "long_text",
      })
    ).toBe(true)
  })
})

describe("which repos are offered first", () => {
  it("puts the person's own repos before forks, then the most starred, then the most recent", () => {
    const ranked = rankRepos([
      repo("old-fork", { fork: true, stars: 99 }),
      repo("quiet", { stars: 0, pushed: "2025-01-01T00:00:00Z" }),
      repo("famous", { stars: 50 }),
      repo("recent", { stars: 0, pushed: "2026-09-01T00:00:00Z" }),
    ])
    expect(ranked.map((r) => r.name)).toEqual([
      "famous",
      "recent",
      "quiet",
      "old-fork",
    ])
  })
})

describe("the repo question in a form", () => {
  const store = new Map<string, string>()
  const connect = (
    repos: Repo[] = [
      repo("kirana-bot", { description: "WhatsApp ordering bot" }),
    ]
  ) => {
    store.set(
      "bolbharo.github.v1",
      JSON.stringify({ token: "gho_x", login: "asha", at: 1 })
    )
    store.set("bolbharo.repos.v1", JSON.stringify(repos))
  }
  const formWithProject = (): Session => {
    const s = demoSession("en-IN")
    return {
      ...s,
      source: "page",
      fields: s.fields
        .slice(0, 3)
        .map((f, i) =>
          i === 2
            ? {
                ...f,
                label:
                  "Please describe one or two projects you have worked on.",
              }
            : f
        ),
    }
  }

  beforeEach(() => {
    store.clear()
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    vi.stubGlobal("window", { dispatchEvent: () => true })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("is marked for asking only when GitHub is connected and a project question is open", async () => {
    const { withProjectChoice } = await import("@/lib/github-client")
    expect(withProjectChoice(formWithProject()).projectChoice).toBeUndefined()
    connect()
    const marked = withProjectChoice(formWithProject())
    expect(marked.projectChoice).toEqual({
      fieldId: "F3",
      stage: "ask",
      repos: [],
      leftover: [],
    })
    expect(
      withProjectChoice({ ...formWithProject(), source: "onboarding" })
        .projectChoice
    ).toBeUndefined()
    expect(
      withProjectChoice({ ...formWithProject(), source: "demo" }).projectChoice
    ).toBeUndefined()
    const noProject = {
      ...demoSession("en-IN"),
      fields: demoSession("en-IN").fields.slice(0, 2),
    }
    expect(withProjectChoice(noProject).projectChoice).toBeUndefined()
  })

  it("is not asked when there are no repos, or the question is already answered", async () => {
    const { withProjectChoice } = await import("@/lib/github-client")
    connect([])
    expect(withProjectChoice(formWithProject()).projectChoice).toBeUndefined()
    connect()
    const answered = formWithProject()
    answered.fields[2].slots.forEach((s) => (s.value = "x"))
    expect(withProjectChoice(answered).projectChoice).toBeUndefined()
  })

  it("is filled from the chosen repos as given, leaving what they cannot say to the interview", async () => {
    connect()
    const FACTS = [
      {
        label: "Project: kirana-bot",
        slot: "answer",
        value: "A WhatsApp ordering bot for kirana stores",
        quote: "WhatsApp ordering bot",
        form: "Your profile",
        savedAt: 1,
        key: "project:kirana-bot",
        source: "github:kirana-bot",
      },
    ]
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes("/readme"))
          return new Response("A WhatsApp ordering bot")
        if (url.includes("/languages")) return Response.json({ Python: 1 })
        if (url.includes("/commits")) return Response.json([])
        if (url === "/api/onboard/extract")
          return Response.json({ facts: FACTS })
        if (url === "/api/prefill") {
          const body = JSON.parse(String(init?.body))
          // The model is only shown the chosen repo's facts and the project question's slots.
          expect(body.saved.length).toBeGreaterThanOrEqual(1)
          expect(
            new Set(body.slots.map((s: { field: string }) => s.field))
          ).toEqual(new Set(["F3"]))
          return Response.json({
            fills: [
              { field: "F3", slot: "what", saved: 0, value: FACTS[0].value },
            ],
          })
        }
        throw new Error(`unexpected ${url}`)
      })
    )
    const { projectFills, loadRepos } = await import("@/lib/github-client")
    const session = formWithProject()
    const fills = await projectFills(session, "F3", loadRepos())
    expect(fills).toHaveLength(1)
    const filled = applyPrefill(session, fills)
    const what = filled.fields[2].slots.find((s) => s.name === "what")!
    expect(what).toMatchObject({
      value: FACTS[0].value,
      fromProfile: false,
      source: "github:kirana-bot",
    })
    const left = openSlots(filled).filter((o) => o.fieldId === "F3")
    expect(left.length).toBeGreaterThan(0)
    expect(left.every((o) => o.slot !== "what")).toBe(true)
  })

  it("is nothing when the repos give nothing", async () => {
    connect()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url === "/api/onboard/extract") return Response.json({ facts: [] })
        return new Response("", { status: 404 })
      })
    )
    const { projectFills, loadRepos } = await import("@/lib/github-client")
    expect(await projectFills(formWithProject(), "F3", loadRepos())).toEqual([])
  })
})

describe("the project step in the session", () => {
  it("moves through its stages without touching the answers", () => {
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: demoSession("en-IN") })
    store.dispatch({
      type: "projects",
      choice: {
        fieldId: "F3",
        stage: "done",
        repos: ["asha/kirana-bot"],
        leftover: ["Who used it?"],
      },
    })
    const s = store.getState().session!
    expect(s.projectChoice).toMatchObject({
      stage: "done",
      leftover: ["Who used it?"],
    })
    expect(s.fields[2].slots.every((x) => x.value === null)).toBe(true)
  })
})

describe("Autofill and a question with several parts", () => {
  const multi = (draft: string): Session => {
    const s = demoSession("en-IN")
    const f = {
      ...s.fields[2],
      entryId: "0:b3",
      draft,
      slots: s.fields[2].slots.map((x) => ({
        ...x,
        value: `${x.name} value`,
        quote: "q",
      })),
    }
    return { ...s, source: "page", fields: [f] }
  }

  it("types the written answer once every part is answered", () => {
    expect(autofillPayload(multi("I built a bot for kirana stores."))).toEqual([
      { ref: "0:b3", value: "I built a bot for kirana stores." },
    ])
  })

  it("falls back to the person's own words when no answer is written yet", () => {
    const out = autofillPayload(multi(""))
    expect(out).toHaveLength(1)
    expect(out[0].value).toContain("value")
  })

  it("waits while any part is still open", () => {
    const s = multi("draft")
    s.fields[0].slots[0].value = null
    expect(autofillPayload(s)).toEqual([])
  })
})

describe("the repo summary and the main questions", () => {
  it("takes the first real paragraph of a README", async () => {
    const { readmeSummary } = await import("@/lib/repos")
    const md = "# Kirana Bot\n\n[![build](x.svg)](y)\n\n![logo](l.png)\n\nA WhatsApp ordering bot that lets **kirana stores** take orders from regulars.\n\n## Setup\n"
    expect(readmeSummary(md)).toBe("A WhatsApp ordering bot that lets kirana stores take orders from regulars.")
    expect(readmeSummary("# T\n\n![x](y)")).toBe("")
  })

  it("asks the role and the outcome, nothing else", async () => {
    const { mainQuestions } = await import("@/lib/repos")
    const open = ["name", "role", "tech", "outcome", "duration"].map((slot) => ({ slot, ask: slot }))
    expect(mainQuestions(open).map((o) => o.slot)).toEqual(["role", "outcome"])
    expect(mainQuestions(open.filter((o) => o.slot !== "role" && o.slot !== "outcome")).map((o) => o.slot)).toEqual(["name", "tech"])
  })

  it("skips the parts it will not ask", () => {
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: demoSession("en-IN") })
    const name = demoSession("en-IN").fields[2].slots[0].name
    store.dispatch({ type: "projects", skip: [name], choice: { fieldId: "F3", stage: "done", repos: [], leftover: [] } })
    expect(store.getState().session!.fields[2].slots[0].skipped).toBe(true)
  })
})

describe("opening the repo picker", () => {
  it.each(["/projects", " /project ", "Open projects", "please open my repos"])("%s opens it", async (t) => {
    const { isProjectsCommand } = await import("@/lib/repos")
    expect(isProjectsCommand(t)).toBe(true)
  })
  it.each(["I built a project last year", "my projects were fun", "open the door"])("%s does not", async (t) => {
    const { isProjectsCommand } = await import("@/lib/repos")
    expect(isProjectsCommand(t)).toBe(false)
  })
})
