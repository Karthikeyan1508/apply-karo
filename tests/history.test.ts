import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { demoSession } from "@/lib/demo"
import {
  cleanUrl,
  mergeRecords,
  parseHistory,
  recordFromSession,
  type FormRecord,
} from "@/lib/history"
import { memoryHistory, setHistoryStore } from "@/lib/history-store"
import type { Session } from "@/lib/types"

const who = vi.hoisted(() => ({
  me: null as null | { id: string; email: string; name: string },
}))
vi.mock("@/lib/identity", () => ({ currentUser: async () => who.me }))

const ORIGIN = "http://localhost:3100"
const ME = { id: "user-1", email: "asha@example.com", name: "Asha" }
const YOU = { id: "user-2", email: "you@example.com", name: "You" }

const rec = (
  id: string,
  filledAt: number,
  over: Partial<FormRecord> = {}
): FormRecord => ({
  id,
  title: `Form ${id}`,
  url: "https://acme.example/apply",
  source: "page",
  filledAt,
  answers: [{ question: "Name", answer: "Asha Patil" }],
  ...over,
})

function sessionWith(
  over: Partial<Session> = {},
  drafts: Record<string, string> = {}
): Session {
  const s = demoSession("en-IN")
  return {
    ...s,
    id: "s-1",
    source: "page",
    formUrl: "https://acme.example/apply?token=secret#frag",
    ...over,
    fields: s.fields.map((f) => ({ ...f, draft: drafts[f.id] ?? "" })),
  }
}

describe("what is kept for a form", () => {
  it("is every question with an answer, from the approved draft", () => {
    const r = recordFromSession(
      sessionWith({}, { F1: " Asha Patil ", F3: "I built a WhatsApp bot." }),
      5
    )!
    expect(r).toMatchObject({
      id: "s-1",
      source: "page",
      filledAt: 5,
      title: demoSession("en-IN").title,
    })
    expect(r.answers.map((a) => a.answer)).toEqual([
      "Asha Patil",
      "I built a WhatsApp bot.",
    ])
    expect(r.answers[0].question).toBe(demoSession("en-IN").fields[0].label)
  })

  it("falls back to what was said when there is no draft", () => {
    const s = sessionWith()
    s.fields[0].slots[0].value = "Asha"
    expect(recordFromSession(s)!.answers).toEqual([
      { question: s.fields[0].label, answer: "Asha" },
    ])
  })

  it("keeps only the origin and path of the address", () => {
    expect(cleanUrl("https://acme.example/apply?token=secret#frag")).toBe(
      "https://acme.example/apply"
    )
    expect(cleanUrl("javascript:alert(1)")).toBeNull()
    expect(cleanUrl(null)).toBeNull()
    expect(recordFromSession(sessionWith({}, { F1: "x" }))!.url).toBe(
      "https://acme.example/apply"
    )
  })

  it("is nothing for the onboarding interview, the demos, or a form with no answers", () => {
    expect(
      recordFromSession(sessionWith({ source: "onboarding" }, { F1: "x" }))
    ).toBeNull()
    expect(
      recordFromSession(sessionWith({ source: "demo" }, { F1: "x" }))
    ).toBeNull()
    expect(recordFromSession(sessionWith())).toBeNull()
  })
})

describe("merging forms", () => {
  it("keeps the newest per form, newest first, and merging twice changes nothing", () => {
    const a = [rec("1", 1), rec("2", 5)]
    const b = [rec("1", 9, { title: "Newer" }), rec("3", 3)]
    const once = mergeRecords(a, b)
    expect(once.map((r) => [r.id, r.filledAt])).toEqual([
      ["1", 9],
      ["2", 5],
      ["3", 3],
    ])
    expect(once[0].title).toBe("Newer")
    expect(mergeRecords(once, b)).toEqual(once)
  })

  it("reads saved text defensively", () => {
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory("nope")).toEqual([])
    expect(
      parseHistory(JSON.stringify([rec("1", 1), { id: 3 }, null]))
    ).toHaveLength(1)
  })
})

describe("history route", () => {
  beforeEach(() => {
    who.me = ME
    setHistoryStore(memoryHistory())
  })
  afterEach(() => setHistoryStore(null))

  const call = (
    method: string,
    body?: unknown,
    origin: string | null = ORIGIN
  ) =>
    new Request(`${ORIGIN}/api/history`, {
      method,
      headers: {
        ...(origin ? { origin } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })

  it("needs a sign-in and a database", async () => {
    const { GET, PUT } = await import("@/app/api/history/route")
    who.me = null
    expect((await GET()).status).toBe(401)
    expect((await PUT(call("PUT", rec("1", 1)))).status).toBe(401)
    who.me = ME
    setHistoryStore(null)
    vi.stubEnv("DATABASE_URL", "")
    const res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe("SYNC_NOT_CONFIGURED")
    vi.unstubAllEnvs()
  })

  it("keeps, lists newest first, and removes one person's forms apart from everyone else's", async () => {
    const { GET, PUT, DELETE } = await import("@/app/api/history/route")
    expect((await PUT(call("PUT", rec("1", 1)))).status).toBe(204)
    await PUT(call("PUT", rec("2", 9)))
    expect(
      (await (await GET()).json()).records.map((r: FormRecord) => r.id)
    ).toEqual(["2", "1"])
    who.me = YOU
    expect((await (await GET()).json()).records).toEqual([])
    who.me = ME
    expect((await DELETE(call("DELETE", { id: "1" }))).status).toBe(204)
    expect(
      (await (await GET()).json()).records.map((r: FormRecord) => r.id)
    ).toEqual(["2"])
    expect((await DELETE(call("DELETE", { all: true }))).status).toBe(204)
    expect((await (await GET()).json()).records).toEqual([])
  })

  it("replaces a form saved twice", async () => {
    const { GET, PUT } = await import("@/app/api/history/route")
    await PUT(call("PUT", rec("1", 1)))
    await PUT(call("PUT", rec("1", 2, { title: "Edited" })))
    const { records } = await (await GET()).json()
    expect(records).toHaveLength(1)
    expect(records[0].title).toBe("Edited")
  })

  it("refuses other sites, bad shapes, and a delete that names nothing", async () => {
    const { PUT, DELETE, GET } = await import("@/app/api/history/route")
    await PUT(call("PUT", rec("1", 1)))
    expect(
      (await PUT(call("PUT", rec("2", 1), "https://evil.example"))).status
    ).toBe(403)
    expect((await DELETE(call("DELETE", { all: true }, null))).status).toBe(403)
    expect((await PUT(call("PUT", { id: "x" }))).status).toBe(400)
    expect((await DELETE(call("DELETE", {}))).status).toBe(400)
    expect(
      (
        await DELETE(
          new Request(`${ORIGIN}/api/history`, {
            method: "DELETE",
            headers: { origin: ORIGIN },
          })
        )
      ).status
    ).toBe(400)
    expect((await (await GET()).json()).records).toHaveLength(1)
  })

  it("reports a database outage as a message", async () => {
    setHistoryStore({
      list: async () => {
        throw new Error("connection refused")
      },
      put: async () => {},
      remove: async () => {},
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { GET } = await import("@/app/api/history/route")
    const res = await GET()
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe("SYNC_FAILED")
  })
})

describe("two devices", () => {
  const store = (stored = new Map<string, string>()) => ({
    stored,
    use() {
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => stored.get(k) ?? null,
        setItem: (k: string, v: string) => void stored.set(k, v),
        removeItem: (k: string) => void stored.delete(k),
      })
      vi.stubGlobal("window", { dispatchEvent: () => true })
    },
  })

  beforeEach(() => {
    who.me = ME
    setHistoryStore(memoryHistory())
    vi.stubGlobal("fetch", async (_u: string, init?: RequestInit) => {
      const { GET, PUT, DELETE } = await import("@/app/api/history/route")
      const method = (init?.method ?? "GET") as "GET" | "PUT" | "DELETE"
      const req = new Request(`${ORIGIN}/api/history`, {
        method,
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: init?.body as string | undefined,
      })
      return method === "GET" ? GET() : { PUT, DELETE }[method](req)
    })
  })
  afterEach(() => {
    setHistoryStore(null)
    vi.unstubAllGlobals()
  })

  it("a form approved on one device shows on the other after signing in, and removing it clears the account", async () => {
    const { recordForm, loadHistory, syncHistory, removeRecord } =
      await import("@/lib/history-client")
    const phone = store()
    const laptop = store()

    phone.use()
    await recordForm(sessionWith({ id: "s-phone" }, { F1: "Asha" }), 10)
    expect(loadHistory().map((r) => r.id)).toEqual(["s-phone"])

    laptop.use()
    // The laptop approved a form while signed out, then signs in.
    who.me = null
    await recordForm(sessionWith({ id: "s-laptop" }, { F1: "Asha" }), 20)
    who.me = ME
    await syncHistory()
    expect(loadHistory().map((r) => r.id)).toEqual(["s-laptop", "s-phone"])

    phone.use()
    await syncHistory()
    expect(loadHistory().map((r) => r.id)).toEqual(["s-laptop", "s-phone"])

    await removeRecord("s-phone")
    expect(loadHistory().map((r) => r.id)).toEqual(["s-laptop"])
    const { GET } = await import("@/app/api/history/route")
    expect(
      (await (await GET()).json()).records.map((r: FormRecord) => r.id)
    ).toEqual(["s-laptop"])
  })

  it("keeps the form on the device when there is no account", async () => {
    const { recordForm, loadHistory } = await import("@/lib/history-client")
    store().use()
    who.me = null
    await recordForm(sessionWith({}, { F1: "Asha" }), 1)
    expect(loadHistory()).toHaveLength(1)
  })

  it("records nothing for the onboarding interview", async () => {
    const { recordForm, loadHistory } = await import("@/lib/history-client")
    store().use()
    expect(
      await recordForm(sessionWith({ source: "onboarding" }, { F1: "x" }))
    ).toBeNull()
    expect(loadHistory()).toEqual([])
  })
})
