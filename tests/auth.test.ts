import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { authInfo, sameOrigin } from "@/lib/auth"
import { mergeNewest } from "@/lib/core"
import { CAPTURE_SNIPPET, parseCapture } from "@/lib/gforms"
import { fillPayload, isExtensionOrigin, PageForm } from "@/lib/page-form"
import {
  forgetProfile,
  loadProfile,
  pushProfile,
  syncProfile,
} from "@/lib/profile"
import { memoryStore, setProfileStore } from "@/lib/profile-store"
import type { ProfileItem } from "@/lib/types"

// Neon Auth needs a Next request scope, so who is signed in is a test switch.
const who = vi.hoisted(() => ({
  me: null as null | {
    id: string
    email: string
    name: string
    image?: string
  },
}))
vi.mock("@/lib/identity", () => ({ currentUser: async () => who.me }))

// The Groq step is not under test here: hand back one field per question.
vi.mock("@/lib/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm")>()),
  llmConfigured: () => true,
  buildIntentGraph: vi.fn(async (form: { fields: { label: string }[] }) =>
    form.fields.map((f, i) => ({
      ...f,
      id: `F${i + 1}`,
      intent: "",
      slots: [],
      draft: "",
      draftSig: "",
      edited: false,
      flags: [],
    }))
  ),
}))

const ORIGIN = "http://localhost:3100"
const ME = {
  id: "user-1",
  email: "asha@example.com",
  name: "Asha Patil",
  image: "https://x/p.png",
}
const YOU = { id: "user-2", email: "you@example.com", name: "You" }

beforeEach(() => {
  who.me = ME
  vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example/neondb/auth")
  vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "c".repeat(40))
  vi.stubEnv("DATABASE_URL", "")
  setProfileStore(memoryStore())
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  setProfileStore(null)
})

const send = (
  method: string,
  path: string,
  opts: { cookie?: string; origin?: string | null; body?: unknown } = {}
) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.origin === null ? {} : { origin: opts.origin ?? ORIGIN }),
      ...(opts.body ? { "content-type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

describe("configuration", () => {
  it("Neon Auth needs its URL and a long cookie secret", async () => {
    const { neonAuth } = await import("@/lib/auth/server")
    expect(neonAuth({})).toBeNull()
    expect(
      neonAuth({
        NEON_AUTH_BASE_URL: "https://a/b",
        NEON_AUTH_COOKIE_SECRET: "short",
      })
    ).toBeNull()
    expect(
      neonAuth({
        NEON_AUTH_BASE_URL: "https://a/b",
        NEON_AUTH_COOKIE_SECRET: "c".repeat(40),
      })
    ).not.toBeNull()
  })
})

describe("origin checks", () => {
  it("accepts a state-changing request only from this site", () => {
    expect(sameOrigin(send("POST", "/x"))).toBe(true)
    expect(
      sameOrigin(send("POST", "/x", { origin: "https://evil.example" }))
    ).toBe(false)
    expect(sameOrigin(send("POST", "/x", { origin: null }))).toBe(false)
    expect(sameOrigin(send("POST", "/x", { origin: "not a url" }))).toBe(false)
  })
})

describe("what the browser is told", () => {
  it("names the person and says what the server can do, and nothing else", () => {
    expect(authInfo(ME, { configured: true, sync: true })).toEqual({
      configured: true,
      sync: true,
      user: { name: ME.name, email: ME.email, picture: ME.image },
    })
  })

  it("says nothing is on when sign-in is not set up", () => {
    expect(authInfo(null, { configured: false, sync: true })).toEqual({
      configured: false,
      sync: false,
      user: null,
    })
  })
})

const item = (label: string, value: string, savedAt: number): ProfileItem => ({
  label,
  slot: "what",
  value,
  quote: value,
  form: "Form",
  savedAt,
})

describe("saved facts in the account", () => {
  it("keeps the newest fact per question, in any order and when merged twice", () => {
    const old = item("Tell us", "old", 1)
    const fresh = item("Tell us", "fresh", 2)
    const other = item("Other", "x", 1)
    expect(mergeNewest([fresh], [old])).toEqual([fresh])
    expect(mergeNewest([old], [fresh])).toEqual([fresh])
    const once = mergeNewest([old, other], [fresh])
    expect(mergeNewest(once, [fresh, old])).toEqual(once)
    expect(once).toHaveLength(2)
  })

  describe("profile route", () => {
    const body = { items: [item("Tell us", "built a bot", 5)] }

    it("needs a sign-in", async () => {
      who.me = null
      const { GET, PUT, DELETE } = await import("@/app/api/profile/route")
      expect((await GET()).status).toBe(401)
      expect((await PUT(send("PUT", "/api/profile", { body }))).status).toBe(
        401
      )
      expect((await DELETE(send("DELETE", "/api/profile"))).status).toBe(401)
    })

    it("says so when there is no database", async () => {
      setProfileStore(null)
      const { GET } = await import("@/app/api/profile/route")
      const res = await GET()
      expect(res.status).toBe(503)
      expect((await res.json()).error.code).toBe("SYNC_NOT_CONFIGURED")
    })

    it("stores, returns and deletes one person's facts, apart from everyone else's", async () => {
      const { GET, PUT, DELETE } = await import("@/app/api/profile/route")
      expect((await PUT(send("PUT", "/api/profile", { body }))).status).toBe(
        200
      )
      expect((await (await GET()).json()).items).toEqual(body.items)
      who.me = YOU as typeof ME
      expect((await (await GET()).json()).items).toEqual([])
      who.me = ME

      // A stale device cannot wipe a newer fact.
      const merged = await (
        await PUT(
          send("PUT", "/api/profile", {
            body: { items: [item("Tell us", "stale", 1)] },
          })
        )
      ).json()
      expect(merged.items[0].value).toBe("built a bot")

      expect((await DELETE(send("DELETE", "/api/profile"))).status).toBe(204)
      expect((await (await GET()).json()).items).toEqual([])
    })

    it("refuses writes from another site and malformed bodies", async () => {
      const { PUT, DELETE } = await import("@/app/api/profile/route")
      expect(
        (
          await PUT(
            send("PUT", "/api/profile", {
              origin: "https://evil.example",
              body,
            })
          )
        ).status
      ).toBe(403)
      expect(
        (await DELETE(send("DELETE", "/api/profile", { origin: null }))).status
      ).toBe(403)
      expect(
        (
          await PUT(
            send("PUT", "/api/profile", { body: { items: [{ label: 1 }] } })
          )
        ).status
      ).toBe(400)
      const tooMany = {
        items: Array.from({ length: 501 }, (_, i) => item(`q${i}`, "v", 1)),
      }
      expect(
        (await PUT(send("PUT", "/api/profile", { body: tooMany }))).status
      ).toBe(400)
    })

    it("reports a database outage as a message, not a crash", async () => {
      setProfileStore({
        get: async () => {
          throw new Error("connection refused")
        },
        put: async () => [],
        remove: async () => {},
      })
      vi.spyOn(console, "error").mockImplementation(() => {})
      const { GET } = await import("@/app/api/profile/route")
      const res = await GET()
      expect(res.status).toBe(502)
      expect((await res.json()).error.code).toBe("SYNC_FAILED")
    })
  })

  describe("two devices", () => {
    /** A browser: its own local storage, talking to the real route handlers. */
    async function device() {
      const store = new Map<string, string>()
      const use = async () => {
        vi.stubGlobal("localStorage", {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
        })
        vi.stubGlobal("window", { dispatchEvent: () => true })
        const { GET, PUT, DELETE } = await import("@/app/api/profile/route")
        vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
          const method = (init?.method ?? "GET") as "GET" | "PUT" | "DELETE"
          const req = new Request(`${ORIGIN}/api/profile`, {
            method,
            headers: {
              origin: ORIGIN,
              ...(init?.headers as Record<string, string>),
            },
            body: init?.body as string | undefined,
          })
          return method === "GET" ? GET() : { PUT, DELETE }[method](req)
        })
      }
      return { store, use }
    }

    it("a fact saved on one device reaches the other, and forgetting removes it from the account", async () => {
      const phone = await device()
      const laptop = await device()

      await phone.use()
      phone.store.set(
        "bolbharo.profile.v1",
        JSON.stringify([item("Tell us", "from the phone", 10)])
      )
      expect(await pushProfile()).toBe(true)

      await laptop.use()
      laptop.store.set(
        "bolbharo.profile.v1",
        JSON.stringify([item("Other", "from the laptop", 20)])
      )
      expect(await syncProfile()).toBe(2)
      expect(
        loadProfile()
          .map((p) => p.value)
          .sort()
      ).toEqual(["from the laptop", "from the phone"])

      await phone.use()
      expect(await syncProfile()).toBe(2)
      expect(loadProfile()).toHaveLength(2)

      await forgetProfile()
      expect(loadProfile()).toEqual([])
      const { GET } = await import("@/app/api/profile/route")
      expect((await (await GET()).json()).items).toEqual([])
    })

    it("syncing while signed out changes nothing on the device", async () => {
      who.me = null
      const d = await device()
      await d.use()
      d.store.set(
        "bolbharo.profile.v1",
        JSON.stringify([item("Tell us", "mine", 1)])
      )
      expect(await syncProfile()).toBeNull()
      expect(loadProfile()).toHaveLength(1)
    })
  })
})

describe("a private form copied out of the person's own browser", () => {
  const data = [
    null,
    [
      null,
      [[1, "Your name", null, 0, [[111, null, 1]]]],
      null,
      null,
      null,
      null,
      null,
      null,
      "Hiring form",
    ],
  ]
  const url =
    "https://docs.google.com/forms/d/e/1FAIpQLSdemoPublishedId/viewform"
  const pasted = JSON.stringify({ bolbharo: "form", url, data })

  it("the snippet copies the page's own data and its address", () => {
    expect(CAPTURE_SNIPPET).toContain("FB_PUBLIC_LOAD_DATA_")
    expect(CAPTURE_SNIPPET).toContain("location.href")
  })

  it("is parsed into the form, keeping the share link for prefilling", () => {
    const got = parseCapture(pasted)!
    expect(got.form.title).toBe("Hiring form")
    expect(got.form.fields[0]).toMatchObject({
      label: "Your name",
      entryId: "111",
    })
    expect(got.url?.toString()).toBe(url)
  })

  it("drops an address that is not a Google Form, and ignores ordinary text", () => {
    expect(
      parseCapture(
        JSON.stringify({
          bolbharo: "form",
          url: "https://evil.example/x",
          data,
        })
      )!.url
    ).toBeNull()
    expect(parseCapture("Tell us about yourself, why this role?")).toBeNull()
    expect(parseCapture(JSON.stringify({ data }))).toBeNull()
    expect(parseCapture("{not json")).toBeNull()
  })

  it("the Paste tab turns it into a Google session with the prefill link", async () => {
    const { POST } = await import("@/app/api/ingest/route")
    const res = await POST(
      new Request(`${ORIGIN}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "text", text: pasted }),
      })
    )
    const { session } = await res.json()
    expect(res.status).toBe(200)
    expect(session).toMatchObject({
      title: "Hiring form",
      source: "google",
      formUrl: url,
    })
    expect(session.fields).toHaveLength(1)
  })
})

describe("a form read off a web page by the extension", () => {
  const page = {
    title: "Acme Hiring",
    url: "https://acme.example/apply",
    fields: [
      {
        ref: "0:b1",
        label: "Full name",
        kind: "text",
        options: [],
        multi: false,
        required: true,
      },
      {
        ref: "0:b2",
        label: "Notice period",
        kind: "choice",
        options: ["Immediately", "30 days"],
        multi: false,
        required: false,
      },
    ],
  }
  const post = (body: unknown) =>
    import("@/app/api/ingest/route").then(({ POST }) =>
      POST(
        new Request(`${ORIGIN}/api/ingest`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      )
    )

  it("becomes a session whose fields remember where they are on the page", async () => {
    const res = await post({ source: "page", page })
    const { session } = await res.json()
    expect(res.status).toBe(200)
    expect(session).toMatchObject({
      title: "Acme Hiring",
      source: "page",
      formUrl: page.url,
    })
    expect(
      session.fields.map((f: { entryId: string; label: string }) => [
        f.entryId,
        f.label,
      ])
    ).toEqual([
      ["0:b1", "Full name"],
      ["0:b2", "Notice period"],
    ])
  })

  it("refuses a missing, empty or oversized form", async () => {
    expect((await post({ source: "page" })).status).toBe(400)
    expect(
      (await post({ source: "page", page: { ...page, fields: [] } })).status
    ).toBe(400)
    const many = Array.from({ length: 101 }, (_, i) => ({
      ...page.fields[0],
      ref: `0:b${i}`,
    }))
    expect(
      (await post({ source: "page", page: { ...page, fields: many } })).status
    ).toBe(400)
  })

  it("only takes known question kinds", () => {
    expect(
      PageForm.safeParse({
        ...page,
        fields: [{ ...page.fields[0], kind: "script" }],
      }).success
    ).toBe(false)
  })

  it("only the extension's own address counts as the extension", () => {
    expect(isExtensionOrigin("chrome-extension://abcdefghijklmnop")).toBe(true)
    expect(isExtensionOrigin("https://evil.example")).toBe(false)
    expect(isExtensionOrigin("http://localhost:3100")).toBe(false)
  })

  it("types back only the answers that exist, by the page's own handles", async () => {
    const { session } = await (await post({ source: "page", page })).json()
    session.fields[0].draft = "  Asha Patil "
    expect(fillPayload(session)).toEqual([{ ref: "0:b1", value: "Asha Patil" }])
  })
})
