import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyPrefill, coverage, matchExact } from "@/lib/core"
import {
  GithubError,
  githubCorpus,
  parseGithubUser,
  pickRepos,
} from "@/lib/github"
import {
  findGaps,
  factsFromOnboarding,
  MAX_GAPS,
  onboardingSession,
} from "@/lib/profile-gaps"
import {
  keyOf,
  isSensitive,
  sectionOf,
  canonicalKey,
  CHECKLIST,
} from "@/lib/profile-keys"
import {
  groundFacts,
  chunkText,
  CHUNK_CHARS,
  type SourceText,
} from "@/lib/profile-ground"
import { extractProfile, MAX_CHUNKS } from "@/lib/profile-extract"
import { linkedinLink, readSources } from "@/lib/onboard-client"
import {
  parseProfileJson,
  prefillFromProfile,
  profileJson,
  saveOnboardingAnswers,
  valid,
} from "@/lib/profile"
import { memoryStore, setProfileStore } from "@/lib/profile-store"
import type { ProfileItem, Session } from "@/lib/types"

// Who is signed in is a test switch: the profile route needs a request scope otherwise.
const who = vi.hoisted(() => ({
  me: null as null | { id: string; email: string; name: string },
}))
vi.mock("@/lib/identity", () => ({ currentUser: async () => who.me }))

const fact = (
  over: Partial<ProfileItem> & Pick<ProfileItem, "label" | "value">
): ProfileItem => ({
  slot: "answer",
  quote: over.value,
  form: "Your profile",
  savedAt: 1,
  ...over,
})

const reply = (content: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { status }
  )

/** A minimal form session with one single-slot field per [label, slot] pair. */
function form(...pairs: [string, string][]): Session {
  return {
    id: "s1",
    title: "Form",
    description: "",
    source: "text",
    formUrl: null,
    context: "",
    lang: "en-IN",
    fields: pairs.map(([label, slot], i) => ({
      id: `F${i + 1}`,
      index: i,
      entryId: null,
      label,
      kind: "text",
      options: [],
      multi: false,
      required: false,
      intent: "",
      slots: [
        {
          name: slot,
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
    })),
  }
}

describe("keys and sections", () => {
  it("maps form questions to canonical keys", () => {
    expect(keyOf("Your email address")).toBe("email")
    expect(keyOf("Full name")).toBe("full_name")
    expect(keyOf("Name of your shop")).toBeNull()
    expect(keyOf("Notice period (days)")).toBe("notice_period")
  })

  it("flags salary, government id and similar fields as sensitive", () => {
    expect(isSensitive("current_ctc", "Current CTC")).toBe(true)
    expect(isSensitive("expected_ctc")).toBe(true)
    expect(isSensitive("date_of_birth")).toBe(true)
    expect(isSensitive("email", "Email")).toBe(false)
  })

  it("groups facts into sections by key, and keeps unknown keys safe", () => {
    expect(sectionOf({ key: "full_name" })).toBe("Identity")
    expect(sectionOf({ key: "project:ledger" })).toBe("Projects")
    expect(sectionOf({ key: "experience:acme" })).toBe("Experience")
    expect(sectionOf({ key: "notice_period" })).toBe("Other")
    expect(canonicalKey("Email", "Email")).toBe("email")
    expect(canonicalKey("project:Smart Ledger!", "x")).toBe(
      "project:smart-ledger"
    )
    expect(canonicalKey("hobbies", "Hobbies: chess")).toBe(
      "other:hobbies-chess"
    )
    expect(CHECKLIST.length).toBeGreaterThan(MAX_GAPS)
  })
})

describe("grounding: a fact survives only if its quote is in a source", () => {
  const sources: SourceText[] = [
    {
      name: "resume.pdf",
      text: "I led a team of 12 engineers at Acme Corp. I built a WhatsApp ordering bot used by 300 shops.",
    },
    { name: "github", text: "Repository: ledger\nStars: 40" },
  ]

  it("keeps grounded facts and drops fabricated quotes, empty values and quotes from nowhere", () => {
    const out = groundFacts(
      [
        {
          key: "full_name",
          label: "Name",
          value: "Asha Patil",
          quote: "Asha Patil",
          source: "resume.pdf",
        },
        {
          key: "experience:acme",
          label: "Experience: Acme",
          value: "Led 12 engineers",
          quote: "led a team of 12 engineers",
          source: "resume.pdf",
        },
        {
          key: "email",
          label: "Email",
          value: "",
          quote: "I led",
          source: "resume.pdf",
        },
        {
          key: "phone",
          label: "Phone",
          value: "9999999999",
          quote: "9999999999",
          source: "resume.pdf",
        },
      ],
      sources,
      5
    )
    expect(out.map((f) => f.key)).toEqual(["experience:acme"])
    expect(out[0]).toMatchObject({
      value: "Led 12 engineers",
      source: "resume.pdf",
      confirmed: false,
      savedAt: 5,
    })
  })

  it("attributes a quote to the source it really came from when the model names the wrong one", () => {
    const [f] = groundFacts(
      [
        {
          key: "project:whatsapp-bot",
          label: "Project",
          value: "WhatsApp bot",
          quote: "WhatsApp ordering bot used by 300 shops",
          source: "github",
        },
      ],
      sources
    )
    expect(f.source).toBe("resume.pdf")
  })

  it("keeps one fact per key and gives every fact a unique label", () => {
    const out = groundFacts(
      [
        {
          key: "project:x",
          label: "Project: X",
          value: "one",
          quote: "led a team",
          source: "resume.pdf",
        },
        {
          key: "project:x",
          label: "Project: X again",
          value: "two",
          quote: "led a team",
          source: "resume.pdf",
        },
        {
          key: "project:y",
          label: "Project: X",
          value: "three",
          quote: "built a WhatsApp",
          source: "resume.pdf",
        },
      ],
      sources
    )
    expect(out.map((f) => f.value)).toEqual(["one", "three"])
    expect(new Set(out.map((f) => f.label)).size).toBe(out.length)
  })

  it("marks sensitive facts so they wait for a confirmation", () => {
    const src: SourceText[] = [
      { name: "resume.pdf", text: "Current CTC: 12 LPA" },
    ]
    const [f] = groundFacts(
      [
        {
          key: "current_ctc",
          label: "CTC",
          value: "12 LPA",
          quote: "Current CTC: 12 LPA",
          source: "resume.pdf",
        },
      ],
      src
    )
    expect(f).toMatchObject({ label: "Current CTC", sensitive: true })
  })

  it("splits long text into overlapping pieces that cover all of it", () => {
    const text = "a".repeat(CHUNK_CHARS * 2 + 10)
    const pieces = chunkText(text)
    expect(pieces.length).toBe(3)
    expect(pieces.every((p) => p.length <= CHUNK_CHARS)).toBe(true)
    expect(pieces[pieces.length - 1].length).toBeGreaterThan(0)
    expect(chunkText("short")).toEqual(["short"])
  })
})

describe("extraction: model calls are chunked, capped and grounded", () => {
  beforeEach(() => vi.stubEnv("GROQ_API_KEY", "test-key"))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("calls the model once per piece, names the source, and keeps only grounded facts", async () => {
    const long = `Asha Patil, Pune. ${"filler ".repeat(3000)}`
    const fetchMock = vi.fn().mockImplementation(async () =>
      reply({
        facts: [
          {
            key: "full_name",
            label: "Name",
            value: "Asha Patil",
            quote: "Asha Patil",
            source: "resume.pdf",
          },
          {
            key: "phone",
            label: "Phone",
            value: "1",
            quote: "not in the document",
            source: "resume.pdf",
          },
        ],
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    const { facts, truncated } = await extractProfile(
      [{ name: "resume.pdf", text: long }],
      7
    )

    expect(fetchMock).toHaveBeenCalledTimes(chunkText(long).length)
    const first = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(first.response_format.json_schema.strict).toBe(true)
    expect(JSON.parse(first.messages[1].content).source).toBe("resume.pdf")
    expect(facts.map((f) => f.key)).toEqual(["full_name"])
    expect(truncated).toBe(false)
  })

  it("reads at most MAX_CHUNKS pieces and says so", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => reply({ facts: [] }))
    vi.stubGlobal("fetch", fetchMock)
    const { truncated } = await extractProfile([
      { name: "resume.pdf", text: "x".repeat(CHUNK_CHARS * (MAX_CHUNKS + 2)) },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CHUNKS)
    expect(truncated).toBe(true)
  })
})

describe("GitHub corpus", () => {
  const repo = (name: string, stars: number, fork = false) => ({
    name,
    full_name: `ada/${name}`,
    html_url: `https://github.com/ada/${name}`,
    description: `${name} description`,
    fork,
    stargazers_count: stars,
    pushed_at: "2026-01-02T00:00:00Z",
    language: "TypeScript",
    topics: ["cli"],
  })
  const user = {
    login: "ada",
    name: "Ada Lovelace",
    bio: "Builds payment tools",
    company: "Acme",
    location: "Pune",
    blog: "https://ada.dev",
    email: null,
    html_url: "https://github.com/ada",
    public_repos: 9,
  }

  function routes(extra: Record<string, () => Response> = {}) {
    const table: Record<string, () => Response> = {
      "/users/ada": () => Response.json(user),
      "/users/ada/repos": () =>
        Response.json([
          repo("r1", 5),
          repo("r2", 50),
          repo("forked", 999, true),
          repo("r3", 1),
          repo("r4", 2),
          repo("r5", 3),
          repo("r6", 4),
          repo("r7", 0),
        ]),
      "/repos/ada/r2/readme": () => new Response("R".repeat(5000)),
      "/repos/ada/r2/languages": () =>
        Response.json({ TypeScript: 900, Go: 100 }),
      ...extra,
    }
    return vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      const hit = Object.entries(table).find(([path]) => url.pathname === path)
      return hit ? hit[1]() : new Response("unexpected", { status: 500 })
    })
  }

  it("excludes forks, takes the top repositories by stars, and truncates READMEs", async () => {
    const f = routes()
    vi.stubGlobal("fetch", f)
    const out = await githubCorpus("ada", {
      fetch: f as unknown as typeof fetch,
    })
    expect(out.repos).toBe(6)
    expect(out.text).toContain("Repository: r2")
    expect(out.text).not.toContain("forked")
    expect(out.text).toContain("Languages: TypeScript, Go")
    expect(out.text).toContain("Company: Acme")
    expect(out.text).not.toContain("Public email")
    const readme = out.text.match(/R{5,}/)?.[0] ?? ""
    expect(readme.length).toBe(2000)
    vi.unstubAllGlobals()
  })

  it("only ever calls api.github.com", async () => {
    const f = routes()
    await githubCorpus("ada", { fetch: f as unknown as typeof fetch })
    for (const [url] of f.mock.calls)
      expect(String(url).startsWith("https://api.github.com/")).toBe(true)
  })

  it("sends the optional token as a bearer header, and never puts it in the text", async () => {
    const f = routes()
    const out = await githubCorpus("ada", {
      fetch: f as unknown as typeof fetch,
      token: "tok-123",
    })
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1]
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer tok-123")
    expect(out.text).not.toContain("tok-123")
  })

  it("says plainly when the user does not exist", async () => {
    const f = routes({
      "/users/ada": () => new Response("{}", { status: 404 }),
    })
    await expect(
      githubCorpus("ada", { fetch: f as unknown as typeof fetch })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  it.each([403, 429])(
    "explains a rate limit (%i) without a stack of detail",
    async (status) => {
      const f = routes({ "/users/ada": () => new Response("{}", { status }) })
      const err = await githubCorpus("ada", {
        fetch: f as unknown as typeof fetch,
      }).catch((e) => e)
      expect(err).toBeInstanceOf(GithubError)
      expect(err.code).toBe("RATE_LIMITED")
      expect(err.message).toMatch(/rate limit/)
    }
  )

  it("validates usernames and profile links, and refuses other hosts", () => {
    expect(parseGithubUser("ada-lovelace")).toBe("ada-lovelace")
    expect(parseGithubUser("https://github.com/ada/")).toBe("ada")
    expect(parseGithubUser("github.com/ada?tab=repos")).toBe("ada")
    expect(parseGithubUser("https://gitlab.com/ada")).toBeNull()
    expect(parseGithubUser("https://github.com.evil.com/ada")).toBeNull()
    expect(parseGithubUser("../etc")).toBeNull()
    expect(parseGithubUser("-ada")).toBeNull()
    expect(parseGithubUser("x".repeat(40))).toBeNull()
    expect(parseGithubUser("   ")).toBeNull()
  })

  it("picks by stars, then by recency, and never a fork", () => {
    const picked = pickRepos([repo("a", 1), repo("b", 9, true), repo("c", 9)])
    expect(picked.map((r) => r.name)).toEqual(["c", "a"])
  })
})

describe("gap analysis and the onboarding interview", () => {
  it("asks only about what the facts do not answer", () => {
    const gaps = findGaps([
      fact({ key: "full_name", label: "Full name", value: "Asha" }),
      fact({ key: "email", label: "Email", value: "a@b.co" }),
    ])
    const keys = gaps.map((g) => g.key)
    expect(keys).not.toContain("full_name")
    expect(keys).not.toContain("email")
    expect(keys).toContain("phone")
    expect(gaps.length).toBeLessThanOrEqual(MAX_GAPS)
  })

  it("adds a question for a project or role with no number, and none when it has one", () => {
    const weak = findGaps([
      fact({
        key: "project:ledger",
        label: "Project: Ledger",
        value: "A ledger app",
      }),
    ])
    const impact = weak.find((g) => g.key === "project:ledger:impact")
    expect(impact).toMatchObject({
      weak: true,
      section: "Projects",
      label: "Result of Ledger",
    })
    const strong = findGaps([
      fact({
        key: "project:ledger",
        label: "Project: Ledger",
        value: "Used by 300 shops",
      }),
    ])
    expect(strong.some((g) => g.key === "project:ledger:impact")).toBe(false)
  })

  it("caps the sitting, and builds one single-slot field per gap, keyed by the gap", () => {
    const gaps = findGaps([])
    expect(gaps).toHaveLength(MAX_GAPS)
    const s = onboardingSession(gaps)
    expect(s.source).toBe("onboarding")
    expect(s.fields.map((f) => f.id)).toEqual(gaps.map((g) => g.key))
    expect(
      s.fields.every(
        (f) => f.slots.length === 1 && f.slots[0].name === "answer"
      )
    ).toBe(true)
  })

  it("turns the captured answers back into confirmed facts with their keys", () => {
    const s = onboardingSession([
      {
        key: "current_ctc",
        label: "Current CTC",
        ask: "?",
        section: "Other",
        weak: false,
        sensitive: true,
      },
      {
        key: "city",
        label: "City",
        ask: "?",
        section: "Identity",
        weak: false,
        sensitive: false,
      },
    ])
    const cur = s.fields.find((f) => f.id === "current_ctc")!
    const city = s.fields.find((f) => f.id === "city")!
    cur.slots[0] = { ...cur.slots[0], value: "12 LPA", quote: "12 LPA" }
    city.slots[0] = {
      ...city.slots[0],
      value: "Pune",
      quote: "Pune",
      fromProfile: false,
    }
    const out = factsFromOnboarding(s, 3)
    expect(out.map((f) => f.key)).toEqual(["current_ctc", "city"])
    expect(out[0]).toMatchObject({
      sensitive: true,
      confirmed: true,
      source: "interview",
      savedAt: 3,
    })
    expect(out[1]).toMatchObject({ sensitive: false, value: "Pune" })
  })
})

describe("autofill rules", () => {
  it("matches the same question, or a single-answer field with the same canonical key", () => {
    const saved = [
      fact({ key: "email", label: "Email", value: "a@b.co", confirmed: true }),
    ]
    expect(
      matchExact(form(["Your email address", "email"]), saved)
    ).toHaveLength(1)
    expect(matchExact(form(["Email", "answer"]), saved)).toHaveLength(1)
    // A multi-slot question is not answered by one fact on its own.
    const two = form(["Your email address", "email"])
    two.fields[0].slots.push({
      name: "second",
      ask: "?",
      value: null,
      quote: null,
      skipped: false,
      fromProfile: false,
    })
    expect(matchExact(two, saved)).toHaveLength(0)
  })

  it("fills a confirmed, non-sensitive fact as an answer, with its source", () => {
    const saved = [
      fact({
        key: "email",
        label: "Email",
        value: "a@b.co",
        quote: "a@b.co",
        source: "resume.pdf",
        confirmed: true,
      }),
    ]
    const s = applyPrefill(
      form(["Your email", "email"]),
      matchExact(form(["Your email", "email"]), saved)
    )
    expect(s.fields[0].slots[0]).toMatchObject({
      value: "a@b.co",
      quote: "a@b.co",
      fromProfile: false,
      source: "resume.pdf",
    })
    expect(coverage(s)).toMatchObject({ filled: 1, pending: 0, open: 0 })
  })

  it("keeps an unconfirmed fact pending, so the interview asks", () => {
    const saved = [
      fact({
        key: "email",
        label: "Email",
        value: "a@b.co",
        source: "resume.pdf",
        confirmed: false,
      }),
    ]
    const s = applyPrefill(
      form(["Email", "email"]),
      matchExact(form(["Email", "email"]), saved)
    )
    expect(s.fields[0].slots[0]).toMatchObject({
      value: "a@b.co",
      fromProfile: true,
    })
    expect(coverage(s)).toMatchObject({ filled: 0, pending: 1 })
  })

  it("keeps a confirmed sensitive fact pending unless the person allowed autofill", () => {
    const f = (autofill?: boolean) => [
      fact({
        key: "current_ctc",
        label: "Current CTC",
        value: "12 LPA",
        confirmed: true,
        sensitive: true,
        autofill,
      }),
    ]
    const pending = applyPrefill(
      form(["Current CTC", "answer"]),
      matchExact(form(["Current CTC", "answer"]), f())
    )
    expect(pending.fields[0].slots[0].fromProfile).toBe(true)
    const allowed = applyPrefill(
      form(["Current CTC", "answer"]),
      matchExact(form(["Current CTC", "answer"]), f(true))
    )
    expect(allowed.fields[0].slots[0]).toMatchObject({
      fromProfile: false,
      value: "12 LPA",
    })
  })

  it("never overwrites an answer already given", () => {
    const saved = [
      fact({
        key: "email",
        label: "Email",
        value: "old@b.co",
        confirmed: true,
      }),
    ]
    const f = form(["Email", "email"])
    f.fields[0].slots[0] = {
      ...f.fields[0].slots[0],
      value: "now@b.co",
      quote: "now@b.co",
    }
    expect(matchExact(f, saved)).toHaveLength(0)
  })

  it("does not pre-fill the onboarding interview, which asks exactly the gaps", async () => {
    const s = onboardingSession(findGaps([]))
    expect(await prefillFromProfile(s, true)).toBe(s)
  })
})

describe("storage: old and new facts, export and import", () => {
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
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("accepts facts saved before the onboarding fields existed, and the new ones", () => {
    const old = {
      label: "Tell us",
      slot: "what",
      value: "x",
      quote: "x",
      form: "Form",
      savedAt: 1,
    }
    const neu = {
      ...old,
      key: "email",
      source: "resume.pdf",
      confirmed: true,
      sensitive: false,
      autofill: false,
    }
    expect(valid(old)).toBe(true)
    expect(valid(neu)).toBe(true)
    expect(valid({ ...old, confirmed: "yes" })).toBe(false)
    expect(valid({ ...old, savedAt: undefined })).toBe(false)
  })

  it("saves reviewed onboarding answers and keeps the newest per question", () => {
    const s = onboardingSession(findGaps([]))
    const city = s.fields.find((f) => f.id === "city")!
    city.slots[0] = { ...city.slots[0], value: "Pune", quote: "Pune" }
    expect(saveOnboardingAnswers(s, 10)).toBe(1)
    expect(saveOnboardingAnswers(s, 20)).toBe(1)
    const stored = JSON.parse(store.get("bolbharo.profile.v1") ?? "[]")
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      key: "city",
      confirmed: true,
      savedAt: 20,
    })
  })

  it("round-trips an export, and refuses a file that is not a profile", () => {
    const facts = [
      fact({
        key: "email",
        label: "Email",
        value: "a@b.co",
        confirmed: true,
        source: "resume.pdf",
      }),
    ]
    const back = parseProfileJson(profileJson(facts, 0))
    expect(back).toEqual(facts)
    expect(() => parseProfileJson("{}")).toThrow(/not a BolBharo profile/)
    expect(() =>
      parseProfileJson(JSON.stringify({ facts: [{ nope: 1 }] }))
    ).toThrow(/no facts/)
  })
})

describe("client reading of sources", () => {
  beforeEach(() => vi.stubEnv("GROQ_API_KEY", "test-key"))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("reads GitHub, keeps the GitHub and LinkedIn links as facts, and says what it could not read", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/onboard/github") {
        return Response.json({
          source: {
            name: "github",
            text: "GitHub profile: https://github.com/ada\nName: Ada",
          },
          login: "ada",
          repos: 0,
        })
      }
      return Response.json({
        facts: [
          {
            key: "full_name",
            label: "Name",
            value: "Ada",
            quote: "Name: Ada",
            source: "github",
          },
        ],
        truncated: false,
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const steps: string[] = []
    const res = await readSources(
      {
        resume: null,
        linkedin: null,
        github: "ada",
        linkedinUrl: "https://www.linkedin.com/in/ada/",
      },
      (s) => steps.push(s),
      1
    )
    expect(steps).toEqual(["github", "facts"])
    const keys = res.facts.map((f) => f.key)
    expect(keys).toEqual(
      expect.arrayContaining(["github", "linkedin", "full_name"])
    )
    expect(res.facts.find((f) => f.key === "github")?.value).toBe(
      "https://github.com/ada"
    )
    expect(res.facts.find((f) => f.key === "linkedin")?.value).toBe(
      "https://www.linkedin.com/in/ada"
    )
    expect(res.notes).toEqual([])
  })

  it("refuses a link that is not on linkedin.com, and reports a GitHub user it cannot find", async () => {
    expect(linkedinLink("https://example.com/in/ada")).toBeNull()
    expect(linkedinLink("linkedin.com/in/ada")).toBe(
      "https://linkedin.com/in/ada"
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "GITHUB_NOT_FOUND",
              message: "GitHub has no public profile for @nobody.",
            },
          },
          { status: 404 }
        )
      )
    )
    const res = await readSources(
      {
        resume: null,
        linkedin: null,
        github: "nobody",
        linkedinUrl: "https://example.com/x",
      },
      () => {},
      1
    )
    expect(res.facts).toEqual([])
    expect(res.notes.join(" ")).toMatch(/GitHub: .*nobody/)
    expect(res.notes.join(" ")).toMatch(/not a linkedin.com link/)
  })
})

describe("routes", () => {
  beforeEach(() => vi.stubEnv("GROQ_API_KEY", "test-key"))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    setProfileStore(null)
  })

  const post = (path: string, body: unknown) =>
    new Request(`http://localhost:3100${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

  it("GitHub route: validates the input, returns a source, and maps errors", async () => {
    const { POST } = await import("@/app/api/onboard/github/route")
    expect(
      (
        await POST(
          post("/api/onboard/github", { input: "https://gitlab.com/x" })
        )
      ).status
    ).toBe(400)

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/users/ada"))
          return Response.json({
            login: "ada",
            name: "Ada",
            bio: null,
            company: null,
            location: null,
            blog: null,
            email: null,
            html_url: "https://github.com/ada",
            public_repos: 0,
          })
        return Response.json([])
      })
    )
    const ok = await POST(post("/api/onboard/github", { input: "ada" }))
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.source.name).toBe("github")
    expect(body.source.text).toContain("GitHub profile: https://github.com/ada")

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 429 }))
    )
    const limited = await POST(post("/api/onboard/github", { input: "ada" }))
    expect(limited.status).toBe(429)
    expect((await limited.json()).error.code).toBe("GITHUB_RATE_LIMITED")
  })

  it("extract route: needs a key, and returns only grounded facts", async () => {
    const { POST } = await import("@/app/api/onboard/extract/route")
    vi.stubEnv("GROQ_API_KEY", "")
    expect(
      (
        await POST(
          post("/api/onboard/extract", {
            sources: [{ name: "r", text: "x".repeat(30) }],
          })
        )
      ).status
    ).toBe(503)
    vi.stubEnv("GROQ_API_KEY", "test-key")
    expect(
      (await POST(post("/api/onboard/extract", { sources: [] }))).status
    ).toBe(400)

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        reply({
          facts: [
            {
              key: "full_name",
              label: "Name",
              value: "Asha Patil",
              quote: "Asha Patil",
              source: "resume.pdf",
            },
            {
              key: "email",
              label: "Email",
              value: "x@y.z",
              quote: "made up",
              source: "resume.pdf",
            },
          ],
        })
      )
    )
    const res = await POST(
      post("/api/onboard/extract", {
        sources: [
          { name: "resume.pdf", text: "Asha Patil, engineer in Pune." },
        ],
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.facts.map((f: ProfileItem) => f.key)).toEqual(["full_name"])
  })

  it("profile route: stores the optional onboarding fields, and still accepts old items", async () => {
    setProfileStore(memoryStore())
    who.me = { id: "u1", email: "a@b.co", name: "A" }
    const { PUT } = await import("@/app/api/profile/route")
    const put = (items: unknown) =>
      PUT(
        new Request("http://localhost:3100/api/profile", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3100",
          },
          body: JSON.stringify({ items }),
        })
      )
    const old = {
      label: "Tell us",
      slot: "what",
      value: "x",
      quote: "x",
      form: "Form",
      savedAt: 1,
    }
    const neu = {
      ...old,
      label: "Email",
      slot: "answer",
      key: "email",
      source: "resume.pdf",
      confirmed: true,
      sensitive: false,
      autofill: false,
    }
    const ok = await put([old, neu])
    expect(ok.status).toBe(200)
    const items = (await ok.json()).items as ProfileItem[]
    expect(items.find((i) => i.key === "email")).toMatchObject({
      source: "resume.pdf",
      confirmed: true,
    })
    expect((await put([{ ...old, confirmed: "yes" }])).status).toBe(400)
    who.me = null
  })
})
