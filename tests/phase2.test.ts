import { describe, expect, it } from "vitest"
import {
  applyPrefill,
  applyUpdates,
  buildPrefillUrl,
  coverage,
  draftFallback,
  draftFlags,
  draftFromValues,
  exportJson,
  exportText,
  factSignature,
  matchExact,
  mergeProfile,
  missingRequired,
  needsDraft,
  openSlotsText,
  planText,
  profileFromSession,
} from "@/lib/core"
import { demoSession } from "@/lib/demo"
import { createInterviewStore, reduce, initialState } from "@/lib/interview-store"
import { handleEditAnswer, handleFinishInterview } from "@/lib/tools"
import type { ProfileItem, Session } from "@/lib/types"

const SAID = ["Hi, I'm Asha Patil, based in Pune", "about four hundred orders a week"]

const saved: ProfileItem = {
  label: "Full name",
  slot: "name",
  value: "Asha Patil",
  quote: "my name is Asha Patil",
  form: "Earlier form",
  savedAt: 1,
}

function withName(): Session {
  return applyUpdates(
    demoSession(),
    [{ field: "F1", slot: "name", value: "Asha Patil", quote: "Asha Patil" }],
    SAID
  ).session
}

describe("saved profile", () => {
  it("matches the same question and slot, and marks the fill as pending", () => {
    const s = applyPrefill(demoSession(), matchExact(demoSession(), [saved]))
    const slot = s.fields[0].slots[0]
    expect(slot).toMatchObject({ value: "Asha Patil", fromProfile: true })
    expect(coverage(s)).toMatchObject({ filled: 0, pending: 1, open: 13, pct: 0 })
    expect(planText(s)).toContain('(from an earlier form: "Asha Patil". Confirm it.)')
    expect(openSlotsText(s)).toContain('F1.name (confirm "Asha Patil")')
  })

  it("does not match other questions or overwrite answered slots", () => {
    expect(matchExact(demoSession(), [{ ...saved, label: "Something else" }])).toHaveLength(0)
    expect(matchExact(withName(), [saved])).toHaveLength(0)
  })

  it("a spoken confirmation keeps the original quote as evidence", () => {
    const pre = applyPrefill(demoSession(), matchExact(demoSession(), [saved]))
    const r = applyUpdates(
      pre,
      [{ field: "F1", slot: "name", value: "asha patil", quote: "Asha Patil" }],
      SAID
    )
    const slot = r.session.fields[0].slots[0]
    expect(r.accepted).toHaveLength(1)
    expect(slot).toMatchObject({ fromProfile: false, quote: "my name is Asha Patil" })
    expect(coverage(r.session).filled).toBe(1)
  })

  it("a correction replaces the saved value and quote", () => {
    const pre = applyPrefill(demoSession(), matchExact(demoSession(), [saved]))
    const r = applyUpdates(
      pre,
      [{ field: "F1", slot: "name", value: "Asha P. Patil", quote: "Asha Patil" }],
      SAID
    )
    expect(r.session.fields[0].slots[0]).toMatchObject({
      value: "Asha P. Patil",
      quote: "Asha Patil",
      fromProfile: false,
    })
  })

  it("a confirmation the user never said is rejected", () => {
    const pre = applyPrefill(demoSession(), matchExact(demoSession(), [saved]))
    const r = applyUpdates(
      pre,
      [{ field: "F1", slot: "name", value: "Asha Patil", quote: "yes that is right" }],
      SAID
    )
    expect(r.rejected).toHaveLength(1)
    expect(r.session.fields[0].slots[0].fromProfile).toBe(true)
  })

  it("saves only confirmed, quoted facts and merges by question and slot", () => {
    const pre = applyPrefill(withName(), matchExact(withName(), [saved]))
    expect(profileFromSession(pre, 5)).toHaveLength(1)
    const empty = applyPrefill(demoSession(), matchExact(demoSession(), [saved]))
    expect(profileFromSession(empty)).toHaveLength(0)

    const newer = { ...saved, value: "Asha K Patil", savedAt: 9 }
    expect(mergeProfile([saved], [newer])).toEqual([newer])
    expect(mergeProfile([saved], [{ ...saved, slot: "other" }])).toHaveLength(2)
  })
})

describe("drafts", () => {
  it("knows when a draft is stale, current, or protected by an edit", () => {
    const s = withName()
    const f = s.fields[0]
    expect(factSignature(f)).toBe("name=Asha Patil")
    expect(needsDraft(f)).toBe(true)
    expect(needsDraft({ ...f, draftSig: factSignature(f) })).toBe(false)
    expect(needsDraft({ ...f, edited: true })).toBe(false)
    expect(needsDraft(demoSession().fields[0])).toBe(false)
  })

  it("ignores unconfirmed profile facts when signing", () => {
    const pre = applyPrefill(demoSession(), matchExact(demoSession(), [saved]))
    expect(factSignature(pre.fields[0])).toBe("")
  })

  it("builds a plain draft without a model", () => {
    expect(draftFromValues({ kind: "text", options: [] }, ["Asha Patil"])).toBe("Asha Patil")
    expect(draftFromValues({ kind: "long_text", options: [] }, ["Built a bot", "Used by 30 shops."])).toBe(
      "Built a bot. Used by 30 shops."
    )
    expect(draftFromValues({ kind: "choice", options: ["Immediate", "1 month"] }, ["in 1 month"])).toBe("1 month")
    expect(draftFallback(withName().fields[0])).toBe("Asha Patil")
  })

  it("flags numbers the user never said and answers over the limit", () => {
    const f = { ...demoSession().fields[2], maxChars: 25 }
    const s = applyUpdates(
      { ...demoSession(), fields: [f] },
      [{ field: "F3", slot: "number", value: "About 400 orders a week", quote: "four hundred orders a week" }],
      SAID
    ).session.fields[0]
    expect(draftFlags(s, "About 400 orders a week")).toEqual([])
    const long = "About 900 orders a week, which is a lot for a small team"
    expect(draftFlags(s, long)).toEqual([
      `Check "900": it isn't in what you told me`,
      `${long.length - 25} characters over the limit`,
    ])
    expect(draftFlags(s, "About 900 orders", "make it 900")).toEqual([])
  })

  it("lists required questions with no answer", () => {
    expect(missingRequired(demoSession()).map((f) => f.id)).toEqual(["F1", "F2", "F3", "F6"])
  })
})

function googleSession(): Session {
  const demo = demoSession()
  const choice = {
    ...demo.fields[0],
    id: "F7",
    index: 6,
    kind: "choice" as const,
    options: ["Immediate", "1 month", "2 months"],
    draft: "1 month",
    entryId: "7007",
  }
  return {
    ...demo,
    source: "google",
    formUrl: "https://docs.google.com/forms/d/e/ABC123/viewform?usp=sf_link",
    fields: [
      { ...demo.fields[0], entryId: "1001", draft: "Asha Patil" },
      { ...demo.fields[1], entryId: null, draft: "Pune" },
      { ...demo.fields[2], entryId: "1003", draft: "A WhatsApp bot & more" },
      choice,
      { ...choice, id: "F8", entryId: "8008", multi: true, draft: "Immediate and 2 months" },
    ],
  }
}

describe("handing over", () => {
  it("builds a prefilled Google Form link", () => {
    const url = new URL(buildPrefillUrl(googleSession()) as string)
    expect(url.origin + url.pathname).toBe("https://docs.google.com/forms/d/e/ABC123/viewform")
    expect(url.searchParams.get("usp")).toBe("pp_url")
    expect(url.searchParams.get("entry.1001")).toBe("Asha Patil")
    expect(url.searchParams.get("entry.1003")).toBe("A WhatsApp bot & more")
    expect(url.searchParams.get("entry.7007")).toBe("1 month")
    expect(url.searchParams.getAll("entry.8008")).toEqual(["Immediate", "2 months"])
    expect(url.searchParams.has("entry.null")).toBe(false)
  })

  it("only builds a link for real Google Forms on docs.google.com", () => {
    expect(buildPrefillUrl(demoSession())).toBeNull()
    expect(buildPrefillUrl({ ...googleSession(), formUrl: "https://forms.gle/abc" })).toBeNull()
    expect(buildPrefillUrl({ ...googleSession(), formUrl: null })).toBeNull()
  })

  it("exports readable text and JSON with the evidence", () => {
    const s = withName()
    s.fields[0].draft = "Asha Patil"
    expect(exportText(s)).toBe("Full name\nAsha Patil")
    const json = JSON.parse(exportJson(s, new Date("2026-10-18T00:00:00Z")))
    expect(json.approvedAt).toBe("2026-10-18T00:00:00.000Z")
    expect(json.answers[0]).toMatchObject({
      question: "Full name",
      answer: "Asha Patil",
      facts: [{ slot: "name", value: "Asha Patil", quote: "Asha Patil" }],
    })
  })
})

describe("store: review flow", () => {
  function done() {
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: demoSession() })
    return store
  }

  it("tracks drafting, drafts, hand edits, approval and reopening", () => {
    const store = done()
    store.dispatch({ type: "drafting", ids: ["F1", "F2"], on: true })
    store.dispatch({ type: "drafting", ids: ["F1"], on: false })
    expect(store.getState().drafting).toEqual(["F2"])

    store.dispatch({ type: "draft", fieldId: "F1", text: "Asha", flags: [], sig: "name=Asha" })
    expect(store.getState().session?.fields[0]).toMatchObject({ draft: "Asha", draftSig: "name=Asha", edited: false })

    store.dispatch({ type: "edit", fieldId: "F1", text: "Asha Patil" })
    expect(store.getState().session?.fields[0]).toMatchObject({ draft: "Asha Patil", edited: true })

    store.dispatch({ type: "approve" })
    expect(store.getState().phase).toBe("interview") // approval needs the review phase first
    store.dispatch({ type: "finish" })
    expect(store.getState().phase).toBe("complete")
    store.dispatch({ type: "approve" })
    expect(store.getState().phase).toBe("approved")
    store.dispatch({ type: "finish" })
    expect(store.getState().phase).toBe("approved") // a late finish can't undo approval
    store.dispatch({ type: "reopen" })
    expect(store.getState().phase).toBe("complete")
  })

  it("flags a hand edit that adds a number the user never gave", () => {
    const s = reduce(
      { ...initialState(), session: withName(), phase: "complete" },
      { type: "edit", fieldId: "F1", text: "Asha Patil, 12 years" }
    )
    expect(s.session?.fields[0].flags).toEqual([`Check "12": it isn't in what you told me`])
  })

  it("finish_interview waits for pending confirmations", () => {
    const store = createInterviewStore()
    const pre = applyPrefill(demoSession(), matchExact(demoSession(), [saved]))
    store.dispatch({ type: "session", session: pre })
    expect(handleFinishInterview(store)).toContain('confirm "Asha Patil"')
  })
})

describe("edit_answer tool", () => {
  function reviewStore() {
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: demoSession() })
    store.dispatch({ type: "utterance", role: "user", text: "make the name answer shorter please" })
    return store
  }

  it("rejects unknown fields and instructions the user never said", async () => {
    const store = reviewStore()
    const rewrite = async () => "never called"
    expect(await handleEditAnswer(store, { field: "F99", instruction: "make it shorter" }, rewrite)).toMatch(/unknown field/)
    expect(await handleEditAnswer(store, { field: "F1", instruction: "translate it to French" }, rewrite)).toMatch(/^rejected/)
  })

  it("passes the user's words to the rewrite and returns the new answer", async () => {
    const store = reviewStore()
    const calls: [string, string][] = []
    const reply = await handleEditAnswer(
      store,
      { field: "F1", instruction: "make the name answer shorter" },
      async (id, ins) => {
        calls.push([id, ins])
        return "Asha"
      }
    )
    expect(calls).toEqual([["F1", "make the name answer shorter"]])
    expect(reply).toBe("updated. The new answer is: Asha")
  })

  it("tells the agent when the rewrite failed", async () => {
    const store = reviewStore()
    const reply = await handleEditAnswer(store, { field: "F1", instruction: "make the name answer shorter" }, async () => null)
    expect(reply).toMatch(/^error/)
  })
})
