import { describe, expect, it } from "vitest"
import { coverage } from "@/lib/core"
import { DEMO_STEPS, demoSession } from "@/lib/demo"
import { createInterviewStore, reduce, initialState } from "@/lib/interview-store"
import { handleFinishInterview, handleRecordAnswers, parseUpdates } from "@/lib/tools"

function playDemo() {
  const store = createInterviewStore()
  store.dispatch({ type: "session", session: demoSession() })
  const finishReplies: string[] = []
  for (const step of DEMO_STEPS) {
    if (step.kind === "agent") store.dispatch({ type: "utterance", role: "agent", text: step.text })
    if (step.kind === "user") store.dispatch({ type: "utterance", role: "user", text: step.text })
    if (step.kind === "tools") store.dispatch({ type: "updates", updates: step.updates })
    if (step.kind === "finish") finishReplies.push(handleFinishInterview(store))
  }
  return { store, finishReplies }
}

describe("demo script", () => {
  it("fills every slot, blocks exactly the one invented quote, and finishes", () => {
    const { store, finishReplies } = playDemo()
    const state = store.getState()
    expect(coverage(state.session).pct).toBe(100)
    expect(state.phase).toBe("complete")
    expect(finishReplies[0]).toMatch(/^done/)

    const rejected = state.guardLog.filter((g) => !g.accepted)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].update.quote).toBe("ninety thousand users")
    expect(rejected[0].reason).toBe("quote not found in what the user said")
    expect(state.guardLog.filter((g) => g.accepted).length).toBeGreaterThan(14)
  })

  it("ends with the better answer for the slot the agent first filled vaguely", () => {
    const what = playDemo().store.getState().session!.fields[2].slots[0]
    expect(what.value).toBe("A WhatsApp ordering bot for kirana stores in Pune")
  })
})

describe("tool handlers", () => {
  it("finish_interview refuses while slots are open and says which", () => {
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: demoSession() })
    const reply = handleFinishInterview(store)
    expect(reply).toMatch(/^not done/)
    expect(reply).toContain("F1.name")
    expect(store.getState().phase).toBe("interview")
  })

  it("record_answers parses a JSON string and reports rejections", () => {
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: demoSession() })
    store.dispatch({ type: "utterance", role: "user", text: "I'm Asha Patil" })
    const reply = handleRecordAnswers(
      store,
      JSON.stringify([
        { field: "F1", slot: "name", value: "Asha Patil", quote: "Asha Patil" },
        { field: "F2", slot: "city", value: "Pune", quote: "in Pune" },
      ])
    )
    expect(reply).toBe("saved 1; rejected 1: F2.city (quote not found in what the user said)")
  })

  it("record_answers survives garbage", () => {
    const store = createInterviewStore()
    store.dispatch({ type: "session", session: demoSession() })
    expect(handleRecordAnswers(store, "not json")).toMatch(/^error/)
    expect(handleRecordAnswers(store, undefined)).toMatch(/^error/)
  })

  it("parseUpdates accepts strings, arrays, a single object and numeric values", () => {
    expect(parseUpdates('[{"field":"F1","slot":"a","value":5,"quote":"five"}]')).toEqual([
      { field: "F1", slot: "a", value: "5", quote: "five" },
    ])
    expect(parseUpdates([{ field: "F1", slot: "a", skip: true }])).toHaveLength(1)
    expect(parseUpdates({ field: "F1", slot: "a", skip: true })).toHaveLength(1)
    expect(parseUpdates('[{"field":1}]')).toBeNull()
  })
})

describe("utterances", () => {
  it("folds growing speech-to-text partials into one line", () => {
    let s = reduce(initialState(), { type: "utterance", role: "user", text: "I built", at: 1000 })
    s = reduce(s, { type: "utterance", role: "user", text: "I built a chatbot", at: 1400 })
    s = reduce(s, { type: "utterance", role: "user", text: "I built a chatbot for shops", at: 1800 })
    expect(s.transcript).toHaveLength(1)
    expect(s.transcript[0].text).toBe("I built a chatbot for shops")
    expect(s.said).toEqual(["I built a chatbot for shops"])
  })

  it("keeps separate turns separate and ignores empty text", () => {
    let s = reduce(initialState(), { type: "utterance", role: "user", text: "Hello", at: 1000 })
    s = reduce(s, { type: "utterance", role: "agent", text: "Hi there", at: 1200 })
    s = reduce(s, { type: "utterance", role: "user", text: "Second thing", at: 9000 })
    s = reduce(s, { type: "utterance", role: "user", text: "   ", at: 9100 })
    expect(s.transcript.map((t) => t.role)).toEqual(["user", "agent", "user"])
  })

  it("restart clears answers but keeps the plan", () => {
    const { store } = playDemo()
    store.dispatch({ type: "restart" })
    const s = store.getState()
    expect(coverage(s.session).pct).toBe(0)
    expect(s.session?.fields).toHaveLength(6)
    expect(s.transcript).toHaveLength(0)
    expect(s.phase).toBe("interview")
  })
})
