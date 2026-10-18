import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  authInfo,
  authUrl,
  clearCookie,
  codeChallenge,
  formsAccess,
  formsConfig,
  formsCookie,
  FORMS_COOKIE,
  FORMS_SCOPE,
  getForms,
  newOAuthState,
  OAUTH_COOKIE,
  readCookie,
  redirectUri,
  sameOrigin,
  seal,
  setCookie,
  unseal,
  type GoogleTokens,
  type OAuthState,
} from "@/lib/auth"
import { mergeNewest } from "@/lib/core"
import { formIdFromUrl, parseFormsApi } from "@/lib/forms-api"
import { CAPTURE_SNIPPET, parseCapture } from "@/lib/gforms"
import { fillPayload, isExtensionOrigin, PageForm } from "@/lib/page-form"
import {
  forgetProfile,
  loadProfile,
  pushProfile,
  setSyncEnabled,
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

const SECRET = "x".repeat(40)
const CLIENT = "client-id.apps.googleusercontent.com"
const cfg = { clientId: CLIENT, clientSecret: "client-secret", secret: SECRET }
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
  vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT)
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret")
  vi.stubEnv("AUTH_SECRET", SECRET)
  vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example/neondb/auth")
  vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "c".repeat(40))
  vi.stubEnv("APP_URL", "")
  vi.stubEnv("DATABASE_URL", "")
  setProfileStore(memoryStore())
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  setProfileStore(null)
})

/** A Cookie header carrying a Forms grant for a user. */
async function grant(uid: string, over: Partial<GoogleTokens> = {}) {
  const g = {
    access: "ya29.live",
    expiresAt: Date.now() + 3_600_000,
    refresh: "1//r",
    ...over,
  }
  return (await formsCookie(uid, g, cfg, false)).split(";")[0]
}

const get = (path: string, cookie?: string) =>
  new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} })
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

const setCookies = (res: Response) => res.headers.getSetCookie()
const cookieValue = (res: Response, name: string) =>
  setCookies(res)
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0]
    .slice(name.length + 1)

describe("configuration", () => {
  it("connecting Forms needs the client id, the secret and a long AUTH_SECRET", () => {
    expect(formsConfig({})).toBeNull()
    expect(
      formsConfig({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })
    ).toBeNull()
    expect(
      formsConfig({
        GOOGLE_CLIENT_ID: "a",
        GOOGLE_CLIENT_SECRET: "b",
        AUTH_SECRET: "short",
      })
    ).toBeNull()
    expect(
      formsConfig({
        GOOGLE_CLIENT_ID: "a",
        GOOGLE_CLIENT_SECRET: "b",
        AUTH_SECRET: SECRET,
      })
    ).toEqual({
      clientId: "a",
      clientSecret: "b",
      secret: SECRET,
    })
  })

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

  it("builds the redirect address from the request, or from APP_URL", () => {
    expect(redirectUri(get("/api/forms/start"), {})).toBe(
      `${ORIGIN}/api/forms/callback`
    )
    expect(
      redirectUri(get("/x"), { APP_URL: "https://bolbharo.example/" })
    ).toBe("https://bolbharo.example/api/forms/callback")
  })
})

describe("sealed cookies", () => {
  it("round-trips a payload and does not show it", async () => {
    const token = await seal(
      { a: 1, email: "asha@example.com" },
      SECRET,
      "forms",
      60
    )
    expect(await unseal<{ a: number }>(token, SECRET, "forms")).toMatchObject({
      a: 1,
    })
    expect(token).not.toContain("asha")
  })

  it("rejects a tampered value, a wrong secret, a wrong purpose and an expired one", async () => {
    const token = await seal({ a: 1 }, SECRET, "forms", 60, 1_000_000)
    const flipped = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA")
    expect(await unseal(flipped, SECRET, "forms", 1_000_000)).toBeNull()
    expect(await unseal(token, "y".repeat(40), "forms", 1_000_000)).toBeNull()
    expect(await unseal(token, SECRET, "oauth", 1_000_000)).toBeNull()
    expect(await unseal(token, SECRET, "forms", 1_000_000 + 61_000)).toBeNull()
    expect(
      await unseal(token, SECRET, "forms", 1_000_000 + 59_000)
    ).not.toBeNull()
    expect(await unseal(undefined, SECRET, "forms")).toBeNull()
    expect(await unseal("not base64 !!", SECRET, "forms")).toBeNull()
  })
})

describe("cookies and origin checks", () => {
  it("reads one cookie from many", () => {
    const req = new Request(ORIGIN, {
      headers: { cookie: "a=1; bb_forms=abc; b=2" },
    })
    expect(readCookie(req, "bb_forms")).toBe("abc")
    expect(readCookie(req, "missing")).toBeUndefined()
  })

  it("sets cookies HttpOnly and SameSite=Lax, and Secure only over https", () => {
    expect(setCookie("n", "v", 60, false)).toBe(
      "n=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60"
    )
    expect(setCookie("n", "v", 60, true)).toContain("; Secure")
    expect(clearCookie("n", false)).toContain("Max-Age=0")
  })

  it("accepts a state-changing request only from this site", () => {
    expect(sameOrigin(send("POST", "/x"))).toBe(true)
    expect(
      sameOrigin(send("POST", "/x", { origin: "https://evil.example" }))
    ).toBe(false)
    expect(sameOrigin(send("POST", "/x", { origin: null }))).toBe(false)
    expect(sameOrigin(send("POST", "/x", { origin: "not a url" }))).toBe(false)
  })
})

describe("the Google address for Forms", () => {
  it("matches the PKCE example in RFC 7636", async () => {
    expect(
      await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  })

  it("asks for read-only Forms access, offline, with consent, and hints the account", () => {
    const st = newOAuthState()
    const url = new URL(
      authUrl(cfg, `${ORIGIN}/api/forms/callback`, st, "c", "asha@example.com")
    )
    const q = url.searchParams
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    )
    expect(q.get("scope")).toBe(FORMS_SCOPE)
    expect(q.get("access_type")).toBe("offline")
    expect(q.get("prompt")).toBe("consent")
    expect(q.get("code_challenge_method")).toBe("S256")
    expect(q.get("state")).toBe(st.state)
    expect(q.get("login_hint")).toBe("asha@example.com")
    expect(q.get("client_secret")).toBeNull()
  })

  it("never reuses a state or verifier", () => {
    const a = newOAuthState()
    const b = newOAuthState()
    expect(a.state).not.toBe(b.state)
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.verifier.length).toBeGreaterThanOrEqual(43)
  })
})

describe("what the browser is told", () => {
  const on = { configured: true, formsAvailable: true, sync: true, forms: true }

  it("never includes a token", () => {
    const text = JSON.stringify(authInfo(ME, on))
    expect(JSON.parse(text)).toMatchObject({
      configured: true,
      sync: true,
      forms: true,
      user: { email: ME.email, picture: ME.image },
    })
    expect(text).not.toContain("ya29")
  })

  it("says nothing is on when sign-in is not set up, and Forms only counts for someone signed in", () => {
    expect(authInfo(null, { ...on, configured: false })).toEqual({
      configured: false,
      formsAvailable: false,
      sync: false,
      user: null,
      forms: false,
    })
    expect(authInfo(null, on).forms).toBe(false)
  })
})

describe("the Forms grant", () => {
  it("belongs to the user it was made for", async () => {
    const jar = await grant(ME.id)
    expect(await getForms(get("/", jar), cfg, ME.id)).toMatchObject({
      access: "ya29.live",
    })
    expect(await getForms(get("/", jar), cfg, YOU.id)).toBeNull()
    expect(await getForms(get("/"), cfg, ME.id)).toBeNull()
  })

  it("uses a fresh token as it is", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    expect(
      await formsAccess(cfg, {
        access: "fresh",
        expiresAt: Date.now() + 3_600_000,
        refresh: "r1",
      })
    ).toEqual({ token: "fresh" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refreshes an expiring one and hands back the tokens to store", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ access_token: "new", expires_in: 3600 })
      )
    vi.stubGlobal("fetch", fetchMock)
    const got = await formsAccess(cfg, {
      access: "old",
      expiresAt: Date.now() + 10_000,
      refresh: "r1",
    })
    expect(got?.token).toBe("new")
    expect(got?.tokens).toMatchObject({ access: "new", refresh: "r1" })
    const sent = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(sent.get("grant_type")).toBe("refresh_token")
    expect(sent.get("refresh_token")).toBe("r1")
  })

  it("gives up quietly when there is nothing to refresh with, or Google refuses", async () => {
    expect(await formsAccess(cfg, { access: "old", expiresAt: 1 })).toBeNull()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 400 }))
    )
    expect(
      await formsAccess(cfg, {
        access: "old",
        expiresAt: 1,
        refresh: "revoked",
      })
    ).toBeNull()
  })
})

describe("connect Google Forms routes", () => {
  it("start: needs a signed-in user", async () => {
    who.me = null
    const { GET } = await import("@/app/api/forms/start/route")
    expect((await GET(get("/api/forms/start"))).headers.get("location")).toBe(
      "/?auth=signin_required"
    )
  })

  it("start: goes home with a reason when Forms is not set up", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "")
    const { GET } = await import("@/app/api/forms/start/route")
    expect((await GET(get("/api/forms/start"))).headers.get("location")).toBe(
      "/?auth=forms_not_configured"
    )
  })

  it("start: redirects to Google and remembers the state in a sealed cookie", async () => {
    const { GET } = await import("@/app/api/forms/start/route")
    const res = await GET(get("/api/forms/start"))
    expect(res.status).toBe(302)
    const to = new URL(res.headers.get("location")!)
    expect(to.origin).toBe("https://accounts.google.com")
    expect(to.searchParams.get("scope")).toBe(FORMS_SCOPE)
    expect(to.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/forms/callback`
    )
    expect(to.searchParams.get("login_hint")).toBe(ME.email)
    const saved = await unseal<OAuthState>(
      cookieValue(res, OAUTH_COOKIE),
      SECRET,
      "oauth"
    )
    expect(saved?.state).toBe(to.searchParams.get("state"))
    expect(setCookies(res)[0]).toContain("HttpOnly")
  })

  describe("callback", () => {
    const state: OAuthState = { state: "s1", verifier: "v".repeat(60) }
    const callback = async (query: string, tokenReply?: Response | Error) => {
      const fetchMock = vi.fn(async (...args: [string | URL, RequestInit?]) => {
        void args
        const r =
          tokenReply ??
          Response.json({
            access_token: "ya29.new",
            expires_in: 3600,
            refresh_token: "1//r",
            scope: FORMS_SCOPE,
          })
        if (r instanceof Error) throw r
        return r
      })
      vi.stubGlobal("fetch", fetchMock)
      const cookie = `${OAUTH_COOKIE}=${await seal(state, SECRET, "oauth", 600)}`
      const { GET } = await import("@/app/api/forms/callback/route")
      return {
        res: await GET(get(`/api/forms/callback?${query}`, cookie)),
        fetchMock,
      }
    }

    it("trades the code for tokens kept inside a sealed cookie, tied to the user", async () => {
      const { res, fetchMock } = await callback("code=abc&state=s1")
      expect(res.headers.get("location")).toBe("/?auth=forms")
      const grantCookie = cookieValue(res, FORMS_COOKIE)
      expect(grantCookie).not.toContain("ya29")
      const got = await getForms(
        get("/", `${FORMS_COOKIE}=${grantCookie}`),
        cfg,
        ME.id
      )
      expect(got).toMatchObject({ access: "ya29.new", refresh: "1//r" })
      expect(
        await getForms(get("/", `${FORMS_COOKIE}=${grantCookie}`), cfg, YOU.id)
      ).toBeNull()
      expect(
        setCookies(res).find((c) => c.startsWith(`${OAUTH_COOKIE}=`))
      ).toContain("Max-Age=0")

      const sent = new URLSearchParams(
        fetchMock.mock.calls[0][1]!.body as string
      )
      expect(sent.get("code")).toBe("abc")
      expect(sent.get("code_verifier")).toBe(state.verifier)
      expect(sent.get("redirect_uri")).toBe(`${ORIGIN}/api/forms/callback`)
    })

    it.each([
      ["a state that does not match", "code=abc&state=forged"],
      ["no code", "state=s1"],
      ["an error from Google", "error=server_error"],
    ])("refuses %s and stores nothing", async (_, query) => {
      const { res, fetchMock } = await callback(query)
      expect(res.headers.get("location")).toBe("/?auth=error")
      expect(cookieValue(res, FORMS_COOKIE)).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("treats a refusal on the consent screen as a cancel", async () => {
      expect(
        (await callback("error=access_denied&state=s1")).res.headers.get(
          "location"
        )
      ).toBe("/?auth=denied")
    })

    it("refuses when nobody is signed in, or the Forms permission was not granted", async () => {
      who.me = null
      expect(
        (await callback("code=abc&state=s1")).res.headers.get("location")
      ).toBe("/?auth=signin_required")
      who.me = ME
      const narrow = Response.json({
        access_token: "a",
        expires_in: 1,
        scope: "openid email",
      })
      const { res } = await callback("code=abc&state=s1", narrow)
      expect(res.headers.get("location")).toBe("/?auth=denied")
      expect(cookieValue(res, FORMS_COOKIE)).toBeUndefined()
    })

    it("refuses a callback with no state cookie, and when Google rejects the code or is unreachable", async () => {
      const { GET } = await import("@/app/api/forms/callback/route")
      expect(
        (await GET(get("/api/forms/callback?code=abc&state=s1"))).headers.get(
          "location"
        )
      ).toBe("/?auth=error")
      expect(
        (
          await callback(
            "code=abc&state=s1",
            new Response("{}", { status: 400 })
          )
        ).res.headers.get("location")
      ).toBe("/?auth=error")
      expect(
        (
          await callback("code=abc&state=s1", new Error("offline"))
        ).res.headers.get("location")
      ).toBe("/?auth=error")
    })
  })

  it("disconnect: only from this site, and it clears the cookie", async () => {
    const { POST } = await import("@/app/api/forms/disconnect/route")
    expect(
      (
        await POST(
          send("POST", "/api/forms/disconnect", {
            origin: "https://evil.example",
          })
        )
      ).status
    ).toBe(403)
    expect(
      (await POST(send("POST", "/api/forms/disconnect", { origin: null })))
        .status
    ).toBe(403)
    const res = await POST(send("POST", "/api/forms/disconnect"))
    expect(res.status).toBe(204)
    expect(setCookies(res)[0]).toContain("Max-Age=0")
  })

  it("account: reports the user and whether Forms is connected, never a token", async () => {
    const { GET } = await import("@/app/api/account/route")
    who.me = null
    expect(await (await GET(get("/api/account"))).json()).toMatchObject({
      configured: true,
      formsAvailable: true,
      user: null,
      forms: false,
    })
    who.me = ME
    const res = await GET(get("/api/account", await grant(ME.id)))
    expect(res.headers.get("cache-control")).toBe("no-store")
    const text = await res.text()
    expect(text).not.toContain("ya29")
    expect(JSON.parse(text)).toMatchObject({
      user: { email: ME.email },
      forms: true,
    })
    // Someone else's grant does not count.
    who.me = YOU as typeof ME
    expect(
      (await (await GET(get("/api/account", await grant(ME.id)))).json()).forms
    ).toBe(false)
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
      setSyncEnabled(true)
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

      setSyncEnabled(true)
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

    it("forgetting with sync off leaves the account alone", async () => {
      const d = await device()
      await d.use()
      d.store.set(
        "bolbharo.profile.v1",
        JSON.stringify([item("Tell us", "mine", 1)])
      )
      await pushProfile()
      await forgetProfile() // sync flag is off on this device
      expect(loadProfile()).toEqual([])
      const { GET } = await import("@/app/api/profile/route")
      expect((await (await GET()).json()).items).toHaveLength(1)
    })
  })
})

describe("reading a private form with a Google account", () => {
  const EDIT =
    "https://docs.google.com/forms/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit"
  const SHARE =
    "https://docs.google.com/forms/d/e/1FAIpQLSdemoPublishedId/viewform"
  const RESPONDER =
    "https://docs.google.com/forms/d/e/1FAIpQLSdemoPublishedId/viewform"
  const API_FORM = {
    info: { title: "Grant application", description: "Tell us" },
    responderUri: RESPONDER,
    items: [
      {
        title: "Your name",
        questionItem: {
          question: {
            questionId: "00a1b2c3",
            required: true,
            textQuestion: {},
          },
        },
      },
      {
        title: "Tell us about it",
        questionItem: {
          question: { questionId: "1f", textQuestion: { paragraph: true } },
        },
      },
      {
        title: "Stage",
        questionItem: {
          question: {
            questionId: "20",
            choiceQuestion: {
              type: "RADIO",
              options: [{ value: "Idea" }, { value: "Live" }],
            },
          },
        },
      },
      {
        title: "Channels",
        questionItem: {
          question: {
            questionId: "21",
            choiceQuestion: { type: "CHECKBOX", options: [{ value: "Web" }] },
          },
        },
      },
      {
        title: "Rate us",
        questionItem: {
          question: { questionId: "22", scaleQuestion: { low: 1, high: 3 } },
        },
      },
      { title: "A section with no question" },
      {
        title: "Upload",
        questionItem: {
          question: { questionId: "23", fileUploadQuestion: {} },
        },
      },
    ],
  }

  describe("parsing", () => {
    it("finds the form id in an edit link but not in a share link", () => {
      expect(formIdFromUrl(new URL(EDIT))).toBe(
        "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"
      )
      expect(
        formIdFromUrl(
          new URL(
            "https://docs.google.com/forms/u/1/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/viewform"
          )
        )
      ).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789")
      expect(formIdFromUrl(new URL(SHARE))).toBeNull()
      expect(formIdFromUrl(new URL("https://forms.gle/abc"))).toBeNull()
    })

    it("maps the questions, and turns the hex question id into the entry number", () => {
      const form = parseFormsApi(API_FORM)!
      expect(form.title).toBe("Grant application")
      expect(form.responderUri).toBe(RESPONDER)
      expect(form.fields.map((f) => [f.label, f.kind, f.multi])).toEqual([
        ["Your name", "text", false],
        ["Tell us about it", "long_text", false],
        ["Stage", "choice", false],
        ["Channels", "choice", true],
        ["Rate us", "choice", false],
      ])
      expect(form.fields[0].entryId).toBe(String(parseInt("00a1b2c3", 16)))
      expect(form.fields[1].entryId).toBe("31")
      expect(form.fields[0].required).toBe(true)
      expect(form.fields[2].options).toEqual(["Idea", "Live"])
      expect(form.fields[4].options).toEqual(["1", "2", "3"])
    })

    it("returns null for a form with nothing to ask about, or for junk", () => {
      expect(parseFormsApi({ items: [{ title: "Section" }] })).toBeNull()
      expect(parseFormsApi(null)).toBeNull()
      expect(parseFormsApi({})).toBeNull()
    })
  })

  describe("ingest", () => {
    let calls: { url: string; auth?: string }[]
    const answer = (
      api: Response | (() => Response) = () => Response.json(API_FORM)
    ) => {
      calls = []
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          calls.push({
            url,
            auth: (init?.headers as Record<string, string> | undefined)
              ?.authorization,
          })
          if (url.startsWith("https://docs.google.com/forms/"))
            return new Response("", { status: 401 })
          if (url.startsWith("https://forms.googleapis.com/"))
            return typeof api === "function" ? api() : api
          if (url === "https://oauth2.googleapis.com/token")
            return Response.json({
              access_token: "refreshed",
              expires_in: 3600,
            })
          throw new Error(`unexpected fetch ${url}`)
        })
      )
    }
    const ingest = async (url: string, cookie?: string) => {
      const { POST } = await import("@/app/api/ingest/route")
      const res = await POST(
        new Request(`${ORIGIN}/api/ingest`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify({ source: "google", url }),
        })
      )
      return { res, body: await res.json() }
    }

    it("someone signed in without Forms connected is told to connect it", async () => {
      answer()
      const { res, body } = await ingest(EDIT)
      expect(res.status).toBe(422)
      expect(body.error.code).toBe("FORM_PRIVATE")
      expect(body.error.message).toContain("Connect your Google account")
      expect(body.error.message).toContain("Paste questions")
      expect(
        calls.some((c) => c.url.startsWith("https://forms.googleapis.com/"))
      ).toBe(false)
    })

    it("a signed-out visitor gets the plain private-form message", async () => {
      who.me = null
      answer()
      const { body } = await ingest(EDIT)
      expect(body.error.code).toBe("FORM_PRIVATE")
      expect(body.error.message).toContain("Paste questions")
    })

    it("reads an edit link through the API with the user's token, and keeps the prefill link", async () => {
      answer()
      const { res, body } = await ingest(EDIT, await grant(ME.id))
      expect(res.status).toBe(200)
      expect(body.session).toMatchObject({
        title: "Grant application",
        source: "google",
        formUrl: RESPONDER,
      })
      expect(body.session.fields).toHaveLength(5)
      const api = calls.find((c) =>
        c.url.startsWith("https://forms.googleapis.com/")
      )!
      expect(api.url).toBe(
        "https://forms.googleapis.com/v1/forms/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"
      )
      expect(api.auth).toBe("Bearer ya29.live")
      expect(res.headers.get("set-cookie")).toBeNull()
    })

    it("does not use someone else's Forms connection", async () => {
      who.me = YOU as typeof ME
      answer()
      const { body } = await ingest(EDIT, await grant(ME.id))
      expect(body.error.code).toBe("FORM_PRIVATE")
      expect(
        calls.some((c) => c.url.startsWith("https://forms.googleapis.com/"))
      ).toBe(false)
    })

    it("asks for the edit link when given a share link", async () => {
      answer()
      const { res, body } = await ingest(SHARE, await grant(ME.id))
      expect(res.status).toBe(422)
      expect(body.error.code).toBe("FORM_NEEDS_EDIT_LINK")
    })

    it("refreshes an expired token and stores the new one", async () => {
      answer()
      const { res, body } = await ingest(
        EDIT,
        await grant(ME.id, { expiresAt: 1 })
      )
      expect(res.status).toBe(200)
      expect(body.session.title).toBe("Grant application")
      expect(
        calls.find((c) => c.url.startsWith("https://forms.googleapis.com/"))!
          .auth
      ).toBe("Bearer refreshed")
      const stored = await getForms(
        get("/", `${FORMS_COOKIE}=${cookieValue(res, FORMS_COOKIE)}`),
        cfg,
        ME.id
      )
      expect(stored).toMatchObject({ access: "refreshed", refresh: "1//r" })
    })

    it("asks to connect again when the token is dead and cannot be refreshed", async () => {
      answer()
      const { body } = await ingest(
        EDIT,
        await grant(ME.id, { expiresAt: 1, refresh: undefined })
      )
      expect(body.error.code).toBe("AUTH_EXPIRED")
    })

    it.each([
      [401, 401, "AUTH_EXPIRED"],
      [403, 403, "FORM_NO_ACCESS"],
      [404, 404, "FETCH_FAILED"],
      [500, 502, "FETCH_FAILED"],
    ])("a %i from Google becomes %i %s", async (google, status, code) => {
      answer(
        new Response(
          JSON.stringify({
            error: { message: "The caller does not have permission" },
          }),
          { status: google }
        )
      )
      const { res, body } = await ingest(EDIT, await grant(ME.id))
      expect(res.status).toBe(status)
      expect(body.error.code).toBe(code)
    })

    it("a 403 passes on what Google said, so a switched-off API is easy to spot", async () => {
      answer(
        new Response(
          JSON.stringify({
            error: {
              message: "Google Forms API has not been used in project 1 before",
            },
          }),
          { status: 403 }
        )
      )
      const { body } = await ingest(EDIT, await grant(ME.id))
      expect(body.error.message).toContain("Google Forms API has not been used")
    })

    it("a public form never touches the Forms API", async () => {
      calls = []
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) => {
          calls.push({ url: String(input) })
          const loadData = JSON.stringify([
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
              "Public form",
            ],
          ])
          return new Response(
            `<script>var FB_PUBLIC_LOAD_DATA_ = ${loadData};</script>`
          )
        })
      )
      const { res, body } = await ingest(SHARE)
      expect(res.status).toBe(200)
      expect(body.session.title).toBe("Public form")
      expect(
        calls.every((c) => c.url.startsWith("https://docs.google.com/"))
      ).toBe(true)
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
