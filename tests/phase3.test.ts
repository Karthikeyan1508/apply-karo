import { afterEach, describe, expect, it, vi } from "vitest"
import { classifyAgentError } from "@/lib/agent-errors"
import {
  AGENT_FIRST_MESSAGE,
  AGENT_SYSTEM_PROMPT,
  DYNAMIC_VARIABLE_DEFAULTS,
} from "@/lib/agent-prompt"
import { agentLanguage, buildDynamicVariables, draftFlags } from "@/lib/core"
import { DEMO_DRAFTS, demoSession, demoSteps, parseReplay, type Lang } from "@/lib/demo"
import { createInterviewStore } from "@/lib/interview-store"
import { structureFromText } from "@/lib/llm"
import { handleFinishInterview, parseUpdates } from "@/lib/tools"

/** Play the scripted interview into a real store, the way the replay does. */
function play(lang: Lang) {
  const store = createInterviewStore()
  store.dispatch({ type: "session", session: demoSession(lang) })
  for (const step of demoSteps(lang)) {
    if (step.kind === "user") store.dispatch({ type: "utterance", role: "user", text: step.text })
    else if (step.kind === "tools") store.dispatch({ type: "updates", updates: step.updates })
    else if (step.kind === "finish") handleFinishInterview(store)
  }
  return store.getState()
}

describe.each<Lang>(["en-IN", "hi-IN"])("scripted demo (%s)", (lang) => {
  it("every quote was said, except the one the guard is meant to block", () => {
    const state = play(lang)
    const blocked = state.guardLog.filter((g) => !g.accepted)
    expect(blocked).toHaveLength(1)
    expect(blocked[0].update).toMatchObject({ field: "F3", slot: "number" })
    expect(blocked[0].reason).toContain("quote not found")
  })

  it("fills every slot and finishes the interview", () => {
    expect(play(lang).phase).toBe("complete")
  })

  it("has a finished answer for each field that raises no review flag", () => {
    const { session } = play(lang)
    for (const f of session!.fields) {
      const draft = DEMO_DRAFTS[lang][f.id]
      expect(draft, `${f.id} has a scripted draft`).toBeTruthy()
      expect(draftFlags(f, draft), `${f.id} flags`).toEqual([])
    }
  })
})

describe("Hindi form", () => {
  it("has the same structure as the English one, written in Devanagari", () => {
    const en = demoSession("en-IN")
    const hi = demoSession("hi-IN")
    expect(hi.lang).toBe("hi-IN")
    expect(hi.fields.map((f) => f.slots.map((s) => s.name))).toEqual(en.fields.map((f) => f.slots.map((s) => s.name)))
    for (const f of hi.fields) {
      expect(f.label).toMatch(/[ऀ-ॿ]/)
      for (const s of f.slots) expect(s.ask).toMatch(/[ऀ-ॿ]/)
    }
  })

  it("asks the agent for Hindi, greets in Hindi and says so in the prompt variable", () => {
    const vars = buildDynamicVariables(demoSession("hi-IN"))
    expect(agentLanguage(demoSession("hi-IN"))).toBe("hi")
    expect(vars.language).toMatch(/^Hindi/)
    expect(vars.greeting).toMatch(/^नमस्ते/)
    expect(agentLanguage(demoSession("en-IN"))).toBeUndefined()
    expect(buildDynamicVariables(demoSession()).language).toBe("English")
  })
})

describe("form reader in a Hindi session", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  async function systemPromptFor(lang: string) {
    vi.stubEnv("GROQ_API_KEY", "test-key")
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "T", fields: [] }) } }] }))
    )
    vi.stubGlobal("fetch", fetchMock)
    await structureFromText("Why do you want this role? Tell us about yourself.", "", lang)
    return JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content as string
  }

  it("asks for Hindi spoken questions, so the agent's first question is not left in English", async () => {
    expect(await systemPromptFor("hi-IN")).toContain("Hindi (Devanagari script)")
  })

  it("leaves English sessions as they were", async () => {
    expect(await systemPromptFor("en-IN")).not.toContain("Hindi")
  })
})

describe("agent setup stays consistent", () => {
  it("every variable the app sends has a default, and every placeholder is one the app sends", () => {
    const sent = Object.keys(buildDynamicVariables(demoSession()))
    expect(Object.keys(DYNAMIC_VARIABLE_DEFAULTS).sort()).toEqual(sent.sort())
    const used = [...`${AGENT_FIRST_MESSAGE} ${AGENT_SYSTEM_PROMPT}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
    for (const name of used) expect(sent, `{{${name}}}`).toContain(name)
  })
})

describe("recorded replay flag", () => {
  it("is off unless asked for", () => {
    expect(parseReplay("")).toBeNull()
    expect(parseReplay("?replay=0")).toBeNull()
    expect(parseReplay("?lang=hi")).toBeNull()
  })

  it("reads language and speed", () => {
    expect(parseReplay("?replay=1")).toEqual({ lang: "en-IN", speed: 1 })
    expect(parseReplay("?replay&lang=hi&speed=2")).toEqual({ lang: "hi-IN", speed: 2 })
    expect(parseReplay("?replay=1&lang=fr&speed=9")).toEqual({ lang: "en-IN", speed: 1 })
  })
})

describe("classifyAgentError", () => {
  it("recognises a blocked microphone", () => {
    expect(classifyAgentError(new DOMException("Permission denied", "NotAllowedError")).kind).toBe("mic")
    expect(classifyAgentError("Microphone permission denied.").kind).toBe("mic")
  })

  it("recognises ElevenLabs refusing the connection", () => {
    expect(classifyAgentError("", "VOICE_AUTH_FAILED").kind).toBe("refused")
    expect(classifyAgentError("Request failed with status 401").kind).toBe("refused")
    expect(classifyAgentError("quota exceeded").kind).toBe("refused")
  })

  it("recognises the network being down and the agent not being set up", () => {
    expect(classifyAgentError(new TypeError("Failed to fetch")).kind).toBe("network")
    expect(classifyAgentError("", "VOICE_NOT_CONFIGURED").kind).toBe("setup")
  })

  it("keeps the message for anything else", () => {
    const e = classifyAgentError("tool call failed")
    expect(e.kind).toBe("agent")
    expect(e.detail).toBe("tool call failed")
  })
})

describe("record_answers payload", () => {
  const good = '[{"field":"F1","slot":"name","value":"Asha","quote":"Asha"}]'

  it("forgives stray closing brackets after the JSON, which the agent sometimes sends", () => {
    expect(parseUpdates(`${good}}`)).toHaveLength(1)
    expect(parseUpdates(`${good}]`)).toHaveLength(1)
    expect(parseUpdates(`  ${good}  `)?.[0].value).toBe("Asha")
  })

  it("still rejects what is not JSON", () => {
    expect(parseUpdates("not json")).toBeNull()
    expect(parseUpdates('[{"field":"F1"')).toBeNull()
  })
})
