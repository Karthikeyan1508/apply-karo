import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { draftAnswer, matchSavedFacts } from "@/lib/llm"

const field = {
  label: "Tell us about something you've built",
  intent: "Proof of ownership",
  kind: "long_text",
  options: [],
  multi: false,
  maxChars: null,
}
const facts = [{ slot: "what", value: "A WhatsApp ordering bot" }]

const reply = (content: unknown, status = 200) =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status }
  )

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-key")
  vi.stubEnv("GROQ_MODEL", "")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("Groq client", () => {
  it("sends a strict json_schema request with the key and returns the parsed answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ text: "I built a WhatsApp ordering bot." }))
    vi.stubGlobal("fetch", fetchMock)

    const out = await draftAnswer({ field, facts })

    expect(out).toBe("I built a WhatsApp ordering bot.")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions")
    expect(init.headers.authorization).toBe("Bearer test-key")
    const body = JSON.parse(init.body)
    expect(body.model).toBe("openai/gpt-oss-120b")
    expect(body.reasoning_effort).toBe("low")
    expect(body.response_format.type).toBe("json_schema")
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined()
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false)
  })

  it("restricts a choice question to its options", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ text: "1 month" }))
    vi.stubGlobal("fetch", fetchMock)
    await draftAnswer({ field: { ...field, kind: "choice", options: ["Immediate", "1 month"] }, facts })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.response_format.json_schema.schema.properties.text.enum).toEqual(["Immediate", "1 month"])
  })

  it("falls back to plain JSON mode when the model rejects schema mode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("response_format json_schema is not supported", { status: 400 }))
      .mockResolvedValueOnce(reply({ text: "ok" }))
    vi.stubGlobal("fetch", fetchMock)
    vi.stubEnv("GROQ_MODEL", "llama-3.3-70b-versatile")

    expect(await draftAnswer({ field, facts })).toBe("ok")
    const retry = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(retry.response_format).toEqual({ type: "json_object" })
    expect(retry.messages[0].content).toContain("JSON Schema")
  })

  it("explains a missing key, a bad key, a rate limit and a malformed reply", async () => {
    vi.stubEnv("GROQ_API_KEY", "")
    await expect(draftAnswer({ field, facts })).rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED" })

    vi.stubEnv("GROQ_API_KEY", "test-key")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })))
    await expect(draftAnswer({ field, facts })).rejects.toMatchObject({ code: "LLM_AUTH" })

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("slow down", { status: 429 })))
    await expect(draftAnswer({ field, facts })).rejects.toMatchObject({ code: "LLM_RATE_LIMIT", status: 429 })

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ wrong: true })))
    await expect(draftAnswer({ field, facts })).rejects.toMatchObject({ code: "LLM_FAILED" })
  })

  it("matches saved facts by index", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ fills: [{ field: "F1", slot: "name", saved: 0, value: "Asha" }] })))
    const fills = await matchSavedFacts({
      slots: [{ field: "F1", slot: "name", ask: "Your name?", question: "Name" }],
      saved: [{ i: 0, question: "Full name", slot: "name", value: "Asha Patil" }],
    })
    expect(fills).toEqual([{ field: "F1", slot: "name", saved: 0, value: "Asha" }])
  })
})
