import { afterEach, describe, expect, it, vi } from "vitest"
import { planText } from "@/lib/core"
import { demoSession } from "@/lib/demo"
import { githubCorpus } from "@/lib/github"
import { autofillPayload } from "@/lib/page-form"
import { knownNote, profileDigest } from "@/lib/profile-digest"
import {
  applyChecks,
  checkReadiness,
  notReadyText,
  ready,
} from "@/lib/readiness"
import type { ProfileItem, Session } from "@/lib/types"

const fact = (label: string, value: string, key?: string): ProfileItem => ({
  label,
  slot: "answer",
  value,
  quote: value,
  form: "f",
  savedAt: 1,
  ...(key ? { key } : {}),
})

const page = (): Session => {
  const s = demoSession("en-IN")
  return {
    ...s,
    source: "page",
    fields: s.fields
      .slice(0, 3)
      .map((f, i) => ({
        ...f,
        entryId: `0:b${i + 1}`,
        slots: [{ ...f.slots[0], value: "x", quote: "x" }],
      })),
  }
}

describe("readiness checks", () => {
  it("attach to the questions the model named and leave the rest unchecked", () => {
    const s = applyChecks(page(), [
      {
        id: "F1",
        understood: true,
        enough: false,
        needs: "your notice period",
      },
    ])
    expect(s.fields[0].check).toEqual({
      understood: true,
      enough: false,
      needs: "your notice period",
    })
    expect(s.fields[1].check).toBeUndefined()
  })

  it("count a question as ready only if it is understood and has enough, and never hold back an unchecked one", () => {
    expect(ready({})).toBe(true)
    expect(
      ready({ check: { understood: true, enough: true, needs: "" } })
    ).toBe(true)
    expect(
      ready({ check: { understood: true, enough: false, needs: "x" } })
    ).toBe(false)
    expect(
      ready({ check: { understood: false, enough: true, needs: "x" } })
    ).toBe(false)
  })

  it("say what is missing or unclear, in one line per question", () => {
    const s = applyChecks(page(), [
      {
        id: "F1",
        understood: true,
        enough: false,
        needs: "your notice period",
      },
      {
        id: "F2",
        understood: false,
        enough: false,
        needs: "which year is meant",
      },
      { id: "F3", understood: true, enough: true, needs: "" },
    ])
    const text = notReadyText(s)
    expect(text).toContain("F1")
    expect(text).toContain("missing: your notice period")
    expect(text).toContain("unclear: which year is meant")
    expect(text).not.toContain("F3")
  })

  it("tell the agent in the plan which questions it is not ready for", () => {
    const s = applyChecks(page(), [
      {
        id: "F2",
        understood: false,
        enough: false,
        needs: "which year is meant",
      },
    ])
    const lines = planText(s).split("\n")
    expect(lines[0]).not.toContain("not ready")
    expect(lines[1]).toContain(
      "not ready (question unclear): which year is meant"
    )
  })

  it("hold a question back from Autofill until it is understood and has enough", () => {
    const base = page()
    expect(autofillPayload(base).map((p) => p.ref)).toEqual([
      "0:b1",
      "0:b2",
      "0:b3",
    ])
    const held = applyChecks(base, [
      { id: "F2", understood: true, enough: false, needs: "x" },
    ])
    expect(autofillPayload(held).map((p) => p.ref)).toEqual(["0:b1", "0:b3"])
  })

  describe("asking the model", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("sends the questions with what is known, and applies the answer", async () => {
      const fetchMock = vi.fn(async () =>
        Response.json({
          checks: [
            { id: "F1", understood: true, enough: false, needs: "salary" },
          ],
        })
      )
      vi.stubGlobal("fetch", fetchMock)
      const out = await checkReadiness(page(), [
        fact("Full name", "Asha Patil"),
      ])
      expect(out.fields[0].check?.needs).toBe("salary")
      const sent = JSON.parse(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
          .body as string
      )
      expect(sent.known).toContain("Full name: Asha Patil")
      expect(sent.questions).toHaveLength(3)
    })

    it("leaves the form alone when the check fails, and skips the interviews about the person", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
      const s = page()
      expect(await checkReadiness(s, [])).toBe(s)
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)
      const onboarding = { ...s, source: "onboarding" as const }
      expect(await checkReadiness(onboarding, [])).toBe(onboarding)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})

describe("readiness route", () => {
  afterEach(() => vi.unstubAllEnvs())
  const post = (body: unknown) =>
    import("@/app/api/readiness/route").then(({ POST }) =>
      POST(
        new Request("http://localhost:3100/api/readiness", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      )
    )

  it("refuses a bad shape, and answers quietly with no model key", async () => {
    expect((await post({})).status).toBe(400)
    vi.stubEnv("GROQ_API_KEY", "")
    const res = await post({
      questions: [
        { id: "F1", label: "Name", kind: "text", options: [], intent: "" },
      ],
    })
    expect(await res.json()).toEqual({ checks: [] })
  })
})

describe("what the agent is told is known", () => {
  it("lists plain facts first, then project and job lines, within a size limit", () => {
    const facts = [
      fact("Project: kirana-bot", "A WhatsApp bot", "project:kirana-bot"),
      fact("Full name", "Asha Patil", "full_name"),
      fact("Email", "a@x.com", "email"),
    ]
    const d = profileDigest(facts)
    expect(d.split("\n")).toEqual([
      "- Full name: Asha Patil",
      "- Email: a@x.com",
      "- Project: kirana-bot: A WhatsApp bot",
    ])
    const long = Array.from({ length: 200 }, (_, i) =>
      fact(`Fact ${i}`, "x".repeat(200))
    )
    expect(profileDigest(long, 1000).length).toBeLessThanOrEqual(1000)
  })

  it("is framed as background, and is nothing when nothing is known", () => {
    expect(knownNote([fact("Full name", "Asha")])).toMatch(
      /never present it as something they just said/
    )
    expect(knownNote([])).toBeNull()
  })
})

describe("GitHub requests", () => {
  it("send headers a request can carry: plain ASCII only", async () => {
    const calls: Record<string, string>[] = []
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init?.headers as Record<string, string>)
      return Response.json({ login: "asha", html_url: "u", public_repos: 0 })
    })
    await githubCorpus("asha", { fetch: f as unknown as typeof fetch }).catch(
      () => {}
    )
    expect(calls.length).toBeGreaterThan(0)
    for (const headers of calls)
      for (const v of Object.values(headers))
        expect(v).toMatch(/^[\x20-\x7e]*$/)
  })
})
