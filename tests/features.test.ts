import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  answerStrength,
  applyDocFacts,
  coverage,
  formatDuration,
  openSlots,
  typingEstimateSecs,
  validDocFills,
} from "@/lib/core"
import { demoSession, demoSteps, MERCHANT_ID, merchantSession } from "@/lib/demo"
import { createInterviewStore } from "@/lib/interview-store"
import { extractFromDocument } from "@/lib/llm"
import { ago, parseSaved, serialize } from "@/lib/persist"
import { handleFinishInterview } from "@/lib/tools"
import type { Session } from "@/lib/types"

/** Play a scripted interview into a real store, the way the replay does. */
function play(session: Session) {
  const store = createInterviewStore()
  store.dispatch({ type: "session", session })
  store.dispatch({ type: "channel", channel: "demo" })
  for (const step of demoSteps(session.lang === "hi-IN" ? "hi-IN" : "en-IN", session.id)) {
    if (step.kind === "user") store.dispatch({ type: "utterance", role: "user", text: step.text })
    else if (step.kind === "tools") store.dispatch({ type: "updates", updates: step.updates })
    else if (step.kind === "finish") handleFinishInterview(store)
  }
  return store
}

describe("resume and refresh safety", () => {
  it("saves nothing on the landing page or without a form", () => {
    expect(serialize(createInterviewStore().getState())).toBeNull()
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: demoSession("en-IN") })
    expect(serialize({ ...store.getState(), phase: "landing" })).toBeNull()
  })

  it("round-trips an interview through storage", () => {
    const state = play(demoSession("en-IN")).getState()
    const saved = parseSaved(serialize(state, 1234))
    expect(saved?.savedAt).toBe(1234)
    expect(saved?.state.phase).toBe("complete")
    expect(saved?.state.session).toEqual(state.session)
    expect(saved?.state.transcript).toEqual(state.transcript)
  })

  it("refuses corrupt, foreign or outdated data", () => {
    expect(parseSaved(null)).toBeNull()
    expect(parseSaved("not json")).toBeNull()
    expect(parseSaved("{}")).toBeNull()
    expect(parseSaved(JSON.stringify({ v: 2, savedAt: 1, state: {} }))).toBeNull()
    const ok = JSON.parse(serialize(play(demoSession("en-IN")).getState())!)
    expect(parseSaved(JSON.stringify({ ...ok, state: { ...ok.state, phase: "landing" } }))).toBeNull()
  })

  it("skips a state too big for storage", () => {
    const state = play(demoSession("en-IN")).getState()
    const big = { ...state, transcript: [{ id: "x", role: "user" as const, text: "a".repeat(1_600_000), at: 0 }] }
    expect(serialize(big)).toBeNull()
  })

  it("says how long ago", () => {
    expect(ago(1000, 1000)).toBe("just now")
    expect(ago(0, 5 * 60_000)).toBe("5 min ago")
    expect(ago(0, 3 * 3_600_000)).toBe("3 h ago")
    expect(ago(0, 3 * 86_400_000)).toBe("3 d ago")
  })

  describe("hydrate", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it("restores the interview and does not count time away", () => {
      vi.setSystemTime(1_000_000)
      const first = createInterviewStore()
      first.dispatch({ type: "session", session: demoSession("en-IN") })
      first.dispatch({ type: "channel", channel: "voice" })
      vi.setSystemTime(1_090_000)
      first.dispatch({ type: "finish" })
      const before = first.getState()
      expect(before.finishedAt! - before.startedAt!).toBe(90_000)

      const saved = parseSaved(serialize(before, 1_090_000))!
      vi.setSystemTime(1_090_000 + 3 * 3_600_000)
      const next = createInterviewStore()
      next.dispatch({ type: "hydrate", saved: saved.state, savedAt: saved.savedAt })
      const after = next.getState()

      expect(after.phase).toBe("complete")
      expect(after.session).toEqual(before.session)
      expect(after.finishedAt! - after.startedAt!).toBe(90_000)
      expect(after.finishedAt).toBe(Date.now())
    })
  })
})

describe("time saved", () => {
  it("formats minutes and seconds", () => {
    expect(formatDuration(192)).toBe("3:12")
    expect(formatDuration(5)).toBe("0:05")
    expect(formatDuration(3600)).toBe("60:00")
    expect(formatDuration(-4)).toBe("0:00")
  })

  it("estimates nothing for an empty form and more for longer answers", () => {
    const s = demoSession("en-IN")
    expect(typingEstimateSecs(s)).toBe(0)
    const short = { ...s, fields: s.fields.map((f, i) => (i === 0 ? { ...f, draft: "Asha Rao" } : f)) }
    const long = {
      ...short,
      fields: short.fields.map((f, i) => (i === 2 ? { ...f, draft: "word ".repeat(80).trim() } : f)),
    }
    expect(typingEstimateSecs(short)).toBe(8) // 2 words at 40 wpm is 3s, plus 5s for a short answer
    expect(typingEstimateSecs(long)).toBeGreaterThan(typingEstimateSecs(short) + 100)
  })

  it("falls back to confirmed facts when there is no draft yet", () => {
    const store = play(demoSession("en-IN"))
    const s = store.getState().session!
    expect(s.fields.every((f) => f.draft === "")).toBe(true)
    expect(typingEstimateSecs(s)).toBeGreaterThan(0)
  })
})

describe("answer strength", () => {
  const job = demoSession("en-IN")
  const f3 = job.fields[2]
  const withValues = (values: Record<string, string>) => ({
    ...f3,
    slots: f3.slots.map((s) => (s.name in values ? { ...s, value: values[s.name], quote: values[s.name] } : s)),
  })

  it("shows nothing for short answers and single-slot long answers", () => {
    expect(answerStrength(job.fields[0])).toBeNull()
    expect(answerStrength(merchantSession().fields[4])).toBeNull()
  })

  it("starts empty and fills as the user gives ownership, a number and an outcome", () => {
    expect(answerStrength(f3)).toMatchObject({ score: 0 })
    const one = answerStrength(withValues({ own_part: "I wrote the bot" }))!
    expect(one.checks.find((c) => c.key === "yours")?.ok).toBe(true)
    expect(one.score).toBe(1)
    const all = answerStrength(
      withValues({ what: "a bot", own_part: "I built it", outcome: "orders doubled", number: "40 shops", users: "shop owners" })
    )!
    expect(all.checks.map((c) => c.key)).toEqual(["yours", "number", "outcome", "detail"])
    expect(all.score).toBe(4)
  })

  it("does not count a number slot that holds no digit, or a fact only pulled from a resume", () => {
    expect(answerStrength(withValues({ number: "a lot" }))!.checks.find((c) => c.key === "number")?.ok).toBe(false)
    const pending = {
      ...f3,
      slots: f3.slots.map((s) => (s.name === "own_part" ? { ...s, value: "I did it", quote: "I did it", fromProfile: true } : s)),
    }
    expect(answerStrength(pending)!.checks.find((c) => c.key === "yours")?.ok).toBe(false)
  })

  it("only asks for what the form can satisfy", () => {
    const merchant = answerStrength(merchantSession().fields[2])!
    expect(merchant.checks.map((c) => c.key)).toEqual(["number", "detail"])
  })
})

describe("documents", () => {
  const resume = "Priya Nair. Built a WhatsApp ordering bot for 40 kirana shops in Pune. Based in Bengaluru."
  const job = demoSession("en-IN")
  const fills = [
    { field: "F1", slot: "name", value: "Priya Nair", quote: "Priya Nair" },
    { field: "F2", slot: "city", value: "Bengaluru", quote: "Based in Bengaluru" },
    { field: "F3", slot: "what", value: "A WhatsApp ordering bot", quote: "Built a WhatsApp ordering bot" },
  ]

  it("keeps only fills whose quote is in the document", () => {
    const invented = { field: "F3", slot: "number", value: "10,000 users", quote: "10,000 users" }
    const kept = validDocFills([...fills, invented], resume, job)
    expect(kept.map((k) => `${k.field}.${k.slot}`)).toEqual(["F1.name", "F2.city", "F3.what"])
  })

  it("drops unknown slots, empty values and a second fill for the same slot", () => {
    const kept = validDocFills(
      [
        fills[0],
        { ...fills[0], value: "Someone Else" },
        { field: "F9", slot: "name", value: "x", quote: "Priya" },
        { field: "F2", slot: "city", value: "  ", quote: "Bengaluru" },
      ],
      resume,
      job
    )
    expect(kept).toHaveLength(1)
    expect(kept[0].value).toBe("Priya Nair")
  })

  it("never overwrites a slot the user already answered", () => {
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: job })
    store.dispatch({ type: "utterance", role: "user", text: "My name is Asha Rao" })
    store.dispatch({ type: "updates", updates: [{ field: "F1", slot: "name", value: "Asha Rao", quote: "Asha Rao" }] })
    const next = applyDocFacts(store.getState().session!, fills, "resume.pdf")
    expect(next.fields[0].slots[0]).toMatchObject({ value: "Asha Rao", quote: "Asha Rao" })
    expect(next.fields[0].slots[0].source).toBeUndefined()
    expect(openSlots(job).some((o) => o.fieldId === "F1" && o.slot === "name")).toBe(true)
    expect(openSlots(next).some((o) => o.fieldId === "F1" && o.slot === "name")).toBe(false)
  })

  it("marks document facts as waiting for a yes, with their source", () => {
    const next = applyDocFacts(job, validDocFills(fills, resume, job), "resume.pdf")
    const slot = next.fields[1].slots[0]
    expect(slot).toMatchObject({ value: "Bengaluru", quote: "Based in Bengaluru", fromProfile: true, source: "resume.pdf" })
    const cov = coverage(next)
    expect(cov.pending).toBe(3)
    expect(cov.filled).toBe(0)
  })

  it("a user's yes confirms the fact and keeps the resume quote as its evidence", () => {
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: applyDocFacts(job, validDocFills(fills, resume, job), "resume.pdf") })
    store.dispatch({ type: "utterance", role: "user", text: "Yes, I'm in Bengaluru" })
    store.dispatch({ type: "updates", updates: [{ field: "F2", slot: "city", value: "Bengaluru", quote: "in Bengaluru" }] })
    const slot = store.getState().session!.fields[1].slots[0]
    expect(slot).toMatchObject({ value: "Bengaluru", quote: "Based in Bengaluru", source: "resume.pdf" })
    expect(slot.fromProfile).toBeFalsy()
    expect(coverage(store.getState().session).pending).toBe(2)
  })

  it("a correction replaces the fact, the quote and the source", () => {
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: applyDocFacts(job, validDocFills(fills, resume, job), "resume.pdf") })
    store.dispatch({ type: "utterance", role: "user", text: "No, I moved to Mumbai" })
    store.dispatch({ type: "updates", updates: [{ field: "F2", slot: "city", value: "Mumbai", quote: "moved to Mumbai" }] })
    const slot = store.getState().session!.fields[1].slots[0]
    expect(slot).toMatchObject({ value: "Mumbai", quote: "moved to Mumbai" })
    expect(slot.source).toBeUndefined()
    expect(slot.fromProfile).toBeFalsy()
  })

  describe("extractFromDocument", () => {
    beforeEach(() => {
      vi.stubEnv("GROQ_API_KEY", "test-key")
      vi.stubEnv("GROQ_MODEL", "")
    })
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    })

    it("sends the document with the open slots and returns the fills", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ fills }) } }] }))
      )
      vi.stubGlobal("fetch", fetchMock)
      const slots = [{ field: "F1", slot: "name", ask: "Your name", question: "Full name" }]
      const out = await extractFromDocument(resume, slots)
      expect(out).toEqual(fills)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      const user = JSON.parse(body.messages.find((m: { role: string }) => m.role === "user").content)
      expect(user.document).toBe(resume)
      expect(user.slots).toEqual(slots)
    })

    it("cuts a very long document to 40k characters", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ fills: [] }) } }] }))
      )
      vi.stubGlobal("fetch", fetchMock)
      await extractFromDocument("x".repeat(50_000), [])
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      const user = JSON.parse(body.messages.find((m: { role: string }) => m.role === "user").content)
      expect(user.document).toHaveLength(40_000)
    })
  })
})

describe("Google Forms that answer with an error", () => {
  beforeEach(() => vi.stubEnv("GROQ_API_KEY", "test-key"))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const ingest = async (status: number) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })))
    const { POST } = await import("@/app/api/ingest/route")
    const res = await POST(
      new Request("http://x/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "google", url: "https://docs.google.com/forms/d/e/1FAIpQLSabc123/viewform" }),
      })
    )
    return { status: res.status, error: (await res.json()).error }
  }

  it.each([401, 403])("a %i means the form needs a sign-in, and says how to get past it", async (code) => {
    const { status, error } = await ingest(code)
    expect(status).toBe(422)
    expect(error.code).toBe("FORM_PRIVATE")
    expect(error.message).toContain("Paste questions")
  })

  it("a 404 says the form was not found", async () => {
    const { status, error } = await ingest(404)
    expect(status).toBe(404)
    expect(error.message).toContain("couldn't find")
  })
})

describe("merchant demo", () => {
  it("is a Hindi form with its own id and a Devanagari ask for every slot", () => {
    const s = merchantSession()
    expect(s.id).toBe(MERCHANT_ID)
    expect(s.lang).toBe("hi-IN")
    for (const f of s.fields) for (const slot of f.slots) expect(slot.ask).toMatch(/[ऀ-ॿ]/)
  })

  it("routes the script by form id, not just by language", () => {
    const merchant = demoSteps("hi-IN", MERCHANT_ID)
    expect(merchant).not.toBe(demoSteps("hi-IN"))
    expect(demoSteps("hi-IN", MERCHANT_ID)).toBe(merchant)
  })

  it("every quote was said, except the one figure the guard is meant to block", () => {
    const state = play(merchantSession()).getState()
    const blocked = state.guardLog.filter((g) => !g.accepted)
    expect(blocked).toHaveLength(1)
    expect(blocked[0].update).toMatchObject({ field: "F3", slot: "daily_sales" })
    expect(blocked[0].reason).toContain("quote not found")
  })

  it("fills every slot after the retry and finishes", () => {
    const state = play(merchantSession()).getState()
    expect(state.phase).toBe("complete")
    expect(coverage(state.session).pct).toBe(100)
    expect(state.session!.fields[2].slots.find((s) => s.name === "daily_sales")?.value).toContain("15,000")
  })

  it("the ingest route is the one place that hands out the form", async () => {
    const { POST } = await import("@/app/api/ingest/route")
    const call = (body: unknown) =>
      POST(new Request("http://x/api/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
    const merchant = await (await call({ source: "demo", demo: "merchant", lang: "en-IN" })).json()
    expect(merchant.session.id).toBe(MERCHANT_ID)
    const job = await (await call({ source: "demo", lang: "hi-IN" })).json()
    expect(job.session.id).not.toBe(MERCHANT_ID)
    expect(job.session.lang).toBe("hi-IN")
  })
})
