import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyPrefill } from "@/lib/core"
import { demoSession } from "@/lib/demo"
import { devicePoll, deviceStart, GITHUB_SCOPE } from "@/lib/github-device"
import { createInterviewStore } from "@/lib/interview-store"
import { lastPage, matchRepos, parseRepos, repoCorpus, repoDigest, type Repo } from "@/lib/repos"

const repo = (name: string, over: Partial<Repo> = {}): Repo => ({
  name,
  full: `asha/${name}`,
  url: `https://github.com/asha/${name}`,
  description: "",
  language: "",
  topics: [],
  stars: 0,
  pushed: "2026-09-01T00:00:00Z",
  private: false,
  fork: false,
  ...over,
})

const REPOS = [
  repo("apply-karo", { description: "Voice interviewer that fills job application forms", language: "TypeScript" }),
  repo("kirana-bot", { description: "WhatsApp ordering bot for kirana stores in Pune", language: "Python", private: true }),
  repo("dotfiles", { description: "My shell setup" }),
  repo("forked-bot", { description: "WhatsApp ordering bot for kirana stores", fork: true }),
]

describe("GitHub device flow", () => {
  const reply = (body: unknown, status = 200) => vi.fn().mockResolvedValue(Response.json(body, { status }))

  it("starts with the repo scope and no secret", async () => {
    const f = reply({ device_code: "dc12345678", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 })
    const out = await deviceStart("client-1", f)
    expect(out).toMatchObject({ deviceCode: "dc12345678", userCode: "ABCD-1234", interval: 5 })
    const sent = new URLSearchParams(f.mock.calls[0][1].body)
    expect(sent.get("client_id")).toBe("client-1")
    expect(sent.get("scope")).toBe(GITHUB_SCOPE)
    expect(sent.has("client_secret")).toBe(false)
  })

  it("never polls faster than GitHub asks", async () => {
    const out = await deviceStart("c", reply({ device_code: "dc12345678", user_code: "A", interval: 1 }))
    expect(out.interval).toBe(5)
  })

  it("says when Device Flow is not switched on for the app", async () => {
    await expect(deviceStart("c", reply({ error: "device_flow_disabled", error_description: "Device Flow must be explicitly enabled" }))).rejects.toThrow(/Device Flow must be explicitly enabled/)
  })

  it.each([
    ["authorization_pending", "pending"],
    ["slow_down", "slow_down"],
    ["expired_token", "expired"],
    ["access_denied", "denied"],
  ])("maps %s to %s", async (error, status) => {
    expect(await devicePoll("c", "dc12345678", reply({ error }))).toEqual({ status })
  })

  it("returns the token once approved", async () => {
    const out = await devicePoll("c", "dc12345678", reply({ access_token: "gho_abc", scope: "repo,read:user" }))
    expect(out).toEqual({ status: "ok", token: "gho_abc", scope: "repo,read:user" })
  })

  it("fails plainly when GitHub is down or answers nonsense", async () => {
    await expect(devicePoll("c", "dc12345678", vi.fn().mockRejectedValue(new Error("offline")))).rejects.toThrow(/Couldn't reach GitHub/)
    await expect(devicePoll("c", "dc12345678", reply({ error: "unsupported_grant_type" }))).rejects.toThrow(/refused/)
  })
})

describe("device routes", () => {
  beforeEach(() => vi.stubEnv("GITHUB_CLIENT_ID", "client-1"))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
  const post = (path: string, body: unknown, origin: string | null = "http://localhost:3100") =>
    new Request(`http://localhost:3100${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    })

  it("refuse other sites and a missing client id", async () => {
    const { POST } = await import("@/app/api/github/device/route")
    expect((await POST(post("/api/github/device", {}, "https://evil.example"))).status).toBe(403)
    vi.stubEnv("GITHUB_CLIENT_ID", "")
    const res = await POST(post("/api/github/device", {}))
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe("GITHUB_NOT_CONFIGURED")
  })

  it("start returns the code, and poll relays the answer", async () => {
    const { POST: start } = await import("@/app/api/github/device/route")
    const { POST: poll } = await import("@/app/api/github/poll/route")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ device_code: "dc12345678", user_code: "WXYZ-9999", interval: 5 })).mockResolvedValueOnce(Response.json({ error: "authorization_pending" })))
    expect((await (await start(post("/api/github/device", {}))).json()).userCode).toBe("WXYZ-9999")
    expect(await (await poll(post("/api/github/poll", { deviceCode: "dc12345678" }))).json()).toEqual({ status: "pending" })
    expect((await poll(post("/api/github/poll", { deviceCode: "x" }))).status).toBe(400)
  })
})

describe("the repo index", () => {
  it("keeps only real repos from GitHub's list", () => {
    const list = parseRepos([{ name: "a", full_name: "u/a", private: true, topics: ["x", 3] }, { nope: 1 }, null, "x"])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: "a", full: "u/a", private: true, topics: ["x"], url: "https://github.com/u/a" })
    expect(parseRepos({})).toEqual([])
  })

  it("finds a repo that is named, with or without separators", () => {
    expect(matchRepos("I built apply karo last year", REPOS)[0]).toMatchObject({ named: true, repo: { name: "apply-karo" } })
    expect(matchRepos("it was called Apply-Karo", REPOS)[0].repo.name).toBe("apply-karo")
    expect(matchRepos("the applykaro thing", REPOS)[0].repo.name).toBe("apply-karo")
  })

  it("finds a repo that is only described, by two shared words", () => {
    const hit = matchRepos("a whatsapp ordering bot for kirana stores", REPOS)
    expect(hit[0]).toMatchObject({ named: false, repo: { name: "kirana-bot" } })
    expect(hit.some((h) => h.repo.fork)).toBe(false)
  })

  it("matches nothing for ordinary chat, or a single shared word", () => {
    expect(matchRepos("yes that is right, thanks", REPOS)).toEqual([])
    expect(matchRepos("I use a bot sometimes", REPOS)).toEqual([])
    expect(matchRepos("", REPOS)).toEqual([])
  })

  it("lists projects for the interviewer without forks, marking private ones", () => {
    const d = repoDigest(REPOS)
    expect(d).toContain("- apply-karo: Voice interviewer")
    expect(d).toContain("kirana-bot (private)")
    expect(d).not.toContain("forked-bot")
  })

  it("reads the last page from a Link header", () => {
    expect(lastPage('<https://api.github.com/x?per_page=1&page=2>; rel="next", <https://api.github.com/x?per_page=1&page=57>; rel="last"')).toBe(57)
    expect(lastPage(null)).toBeNull()
  })

  it("writes a corpus with the repo's own facts to quote", () => {
    const text = repoCorpus({ repo: REPOS[1], readme: "Takes orders on WhatsApp.", languages: ["Python"], mine: 40, total: 52, first: "", last: "2026-08-02" })
    expect(text).toContain("[private]")
    expect(text).toContain("Commits by you: 40 of 52")
    expect(text).toContain("README:\nTakes orders on WhatsApp.")
  })
})

describe("relating what the person says to a repo", () => {
  const store = new Map<string, string>()
  const calls: string[] = []
  const FACTS = [
    { label: "Project: kirana-bot", slot: "answer", value: "A WhatsApp ordering bot for kirana stores", quote: "WhatsApp ordering bot for kirana stores in Pune", form: "Your profile", savedAt: 1, key: "project:kirana-bot", source: "github:kirana-bot" },
    { label: "Outcome: kirana-bot", slot: "answer", value: "Took 400 orders a week", quote: "Takes orders on WhatsApp", form: "Your profile", savedAt: 1, key: "achievement:orders", source: "github:kirana-bot" },
  ]

  beforeEach(() => {
    store.clear()
    calls.length = 0
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    vi.stubGlobal("window", { dispatchEvent: () => true })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push(url)
        if (url.endsWith("/user")) return Response.json({ login: "asha" })
        if (url.includes("/user/repos")) {
          return Response.json([
            { name: "apply-karo", full_name: "asha/apply-karo", description: "Voice interviewer that fills job application forms", private: false },
            { name: "kirana-bot", full_name: "asha/kirana-bot", description: "WhatsApp ordering bot for kirana stores in Pune", private: true, language: "Python" },
          ])
        }
        if (url.includes("/readme")) return new Response("Takes orders on WhatsApp.")
        if (url.includes("/languages")) return Response.json({ Python: 100 })
        if (url.includes("/commits")) return Response.json([{ commit: { author: { date: "2026-08-02T00:00:00Z" } } }], { headers: { link: '<https://api.github.com/x?page=40>; rel="last"' } })
        if (url === "/api/onboard/extract") return Response.json({ facts: FACTS })
        if (url === "/api/prefill") {
          const body = JSON.parse(String(init?.body))
          const slot = body.slots.find((s: { slot: string }) => s.slot === "what")
          return Response.json({ fills: slot ? [{ field: slot.field, slot: slot.slot, saved: 0 }] : [] })
        }
        throw new Error(`unexpected ${url}`)
      })
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it("connects, indexing every repo the token can see", async () => {
    const { connect, loadLink, loadRepos } = await import("@/lib/github-client")
    const out = await connect("gho_token")
    expect(out.login).toBe("asha")
    expect(loadRepos().map((r) => r.name)).toEqual(["apply-karo", "kirana-bot"])
    expect(loadLink()).toMatchObject({ token: "gho_token", login: "asha" })
    expect(calls.every((u) => u.startsWith("https://api.github.com/") || u.startsWith("/"))).toBe(true)
  })

  it("asks only the repo's own facts to fill the open slots, as to-confirm", async () => {
    const { connect, relateProject } = await import("@/lib/github-client")
    await connect("gho_token")
    const session = demoSession("en-IN")
    const found = await relateProject(session, "I built a WhatsApp ordering bot for kirana stores", new Set())
    expect(found && "related" in found).toBe(true)
    if (!found || !("related" in found)) return
    expect(found.related.repo.name).toBe("kirana-bot")
    expect(found.related.fills).toHaveLength(1)
    const filled = applyPrefill(session, found.related.fills)
    const slot = filled.fields.flatMap((f) => f.slots).find((s) => s.name === "what")!
    expect(slot).toMatchObject({ value: "A WhatsApp ordering bot for kirana stores", fromProfile: true, source: "github:kirana-bot" })
    // The token only ever went to GitHub.
    const withToken = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls.filter(([, i]) => JSON.stringify(i?.headers ?? {}).includes("gho_token"))
    expect(withToken.every(([u]) => u.startsWith("https://api.github.com/"))).toBe(true)
  })

  it("does not repeat itself for a repo already matched this call, or touch the onboarding interview", async () => {
    const { connect, relateProject } = await import("@/lib/github-client")
    await connect("gho_token")
    const seen = new Set<string>()
    const session = demoSession("en-IN")
    expect(await relateProject(session, "the kirana-bot project", seen)).not.toBeNull()
    expect(await relateProject(session, "the kirana-bot project again", seen)).toBeNull()
    expect(await relateProject({ ...session, source: "onboarding" }, "kirana-bot", new Set())).toBeNull()
  })

  it("asks which one when two repos fit and none is named", async () => {
    const { connect, relateProject } = await import("@/lib/github-client")
    await connect("gho_token")
    const repos = JSON.parse(store.get("bolbharo.repos.v1")!)
    repos[0].description = "WhatsApp ordering bot for kirana stores, voice version"
    store.set("bolbharo.repos.v1", JSON.stringify(repos))
    const found = await relateProject(demoSession("en-IN"), "that whatsapp ordering bot for kirana stores", new Set())
    expect(found && "ask" in found && found.ask).toMatch(/apply-karo, kirana-bot|kirana-bot, apply-karo/)
  })

  it("does nothing without a connection, and says nothing about projects in chat", async () => {
    const { relateProject, briefing } = await import("@/lib/github-client")
    expect(await relateProject(demoSession("en-IN"), "kirana-bot", new Set())).toBeNull()
    expect(briefing()).toBeNull()
  })

  it("briefs the interviewer with the projects once connected", async () => {
    const { connect, briefing } = await import("@/lib/github-client")
    await connect("gho_token")
    const text = briefing()!
    expect(text).toContain("@asha")
    expect(text).toContain("kirana-bot (private)")
  })

  it("clears the token and everything read from it on disconnect", async () => {
    const { connect, clearLink, loadLink, loadRepos } = await import("@/lib/github-client")
    await connect("gho_token")
    clearLink()
    expect(loadLink()).toBeNull()
    expect(loadRepos()).toEqual([])
  })

  it("polls until approved, slowing down when told", async () => {
    const { waitForApproval } = await import("@/lib/github-client")
    const answers = [{ status: "pending" }, { status: "slow_down" }, { status: "ok", token: "gho_new" }]
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(answers.shift())))
    const waits: number[] = []
    const out = await waitForApproval({ deviceCode: "dc12345678", userCode: "A", verificationUri: "u", expiresIn: 900, interval: 5 }, () => false, async (ms) => void waits.push(ms))
    expect(out).toEqual({ token: "gho_new" })
    expect(waits).toEqual([5000, 5000, 10000])
  })

  it("stops when cancelled", async () => {
    const { waitForApproval } = await import("@/lib/github-client")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const out = await waitForApproval({ deviceCode: "dc12345678", userCode: "A", verificationUri: "u", expiresIn: 900, interval: 5 }, () => true, async () => {})
    expect(out).toBe("cancelled")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("facts found mid-call", () => {
  it("fill only empty slots and leave what the person already said", () => {
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: demoSession("en-IN") })
    store.dispatch({ type: "utterance", role: "user", text: "I built a chatbot" })
    store.dispatch({ type: "updates", updates: [{ field: "F3", slot: "what", value: "A chatbot", quote: "I built a chatbot" }] })
    const item = { label: "Project: x", slot: "answer", value: "From the repo", quote: "q", form: "Your profile", savedAt: 1, source: "github:x" }
    store.dispatch({
      type: "prefill",
      fills: [
        { fieldId: "F3", slot: "what", item },
        { fieldId: "F3", slot: "own_part", item },
      ],
    })
    const slots = Object.fromEntries(store.getState().session!.fields[2].slots.map((s) => [s.name, s]))
    expect(slots.what).toMatchObject({ value: "A chatbot" })
    expect(slots.own_part).toMatchObject({ value: "From the repo", fromProfile: true })
  })
})

describe("facts saved from an approved form", () => {
  const store = new Map<string, string>()
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

  it("are confirmed, so the next form fills them without asking, except form-specific and sensitive ones", async () => {
    const { saveProfile, loadProfile } = await import("@/lib/profile")
    const s = demoSession("en-IN")
    const say = (field: string, slot: string, value: string) => {
      const st = createInterviewStore()
      void st
      const f = s.fields.find((x) => x.id === field)!
      const sl = f.slots.find((x) => x.name === slot)!
      sl.value = value
      sl.quote = value
    }
    say("F1", "name", "Asha Patil")
    say("F6", "motivation", "I like fintech")
    s.fields[0].label = "Full name"
    s.fields[5].label = "Why do you want to join us?"
    saveProfile(s)
    const saved = Object.fromEntries(loadProfile().map((p) => [p.label, p]))
    expect(saved["Full name"]).toMatchObject({ confirmed: true, key: "full_name", sensitive: false })
    expect(saved["Why do you want to join us?"].confirmed).toBe(false)
  })
})
