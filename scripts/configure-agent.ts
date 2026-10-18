/**
 * Applies the BolBharo setup to your ElevenLabs agent: system prompt, first message, dynamic
 * variable defaults, a fast LLM, and the three client tools. Safe to run again: tools are matched
 * by name and updated in place.
 *
 *   npm run configure:agent            apply
 *   npm run configure:agent -- --dry   show what would be sent
 *
 * Reads ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID from .env.local. The key is never printed.
 */
import {
  AGENT_EXTRA_LANGUAGES,
  AGENT_FIRST_MESSAGE,
  AGENT_HINGLISH_MODE,
  AGENT_LLM,
  AGENT_LLM_FALLBACKS,
  AGENT_SYSTEM_PROMPT,
  AGENT_TEMPERATURE,
  AGENT_TOOLS,
  DYNAMIC_VARIABLE_DEFAULTS,
} from "../lib/agent-prompt.ts"
import { loadEnv } from "./env.ts"

const BASE = "https://api.elevenlabs.io/v1/convai"
const dry = process.argv.includes("--dry")

const env = loadEnv()
const KEY = env.ELEVENLABS_API_KEY
const AGENT = env.ELEVENLABS_AGENT_ID
if (!KEY || !AGENT) {
  console.error("Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in .env.local first.")
  process.exit(1)
}

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new ApiError(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`, res.status)
  return text ? JSON.parse(text) : {}
}

function toolConfig(t: (typeof AGENT_TOOLS)[number]) {
  const config: Record<string, unknown> = {
    type: "client",
    name: t.name,
    description: t.description,
    expects_response: t.waitForResponse,
    response_timeout_secs: t.timeoutSecs,
  }
  if (t.parameters.length) {
    config.parameters = {
      type: "object",
      required: t.parameters.filter((p) => p.required).map((p) => p.name),
      properties: Object.fromEntries(
        t.parameters.map((p) => [p.name, { type: p.type, description: p.description }])
      ),
    }
  }
  return config
}

async function upsertTools(): Promise<string[]> {
  const existing = await api("GET", "/tools?page_size=100")
  const byName = new Map<string, string>()
  for (const t of existing.tools ?? []) {
    if (t?.tool_config?.name) byName.set(t.tool_config.name, t.id)
  }
  const ids: string[] = []
  for (const t of AGENT_TOOLS) {
    const body = { tool_config: toolConfig(t) }
    if (dry) {
      console.log(`[dry] tool ${t.name}:`, JSON.stringify(body))
      ids.push(byName.get(t.name) ?? `(new ${t.name})`)
      continue
    }
    const id = byName.get(t.name)
    const res = id ? await api("PATCH", `/tools/${id}`, body) : await api("POST", "/tools", body)
    ids.push(res.id ?? id)
    console.log(`${id ? "updated" : "created"} tool ${t.name} (wait for response: ${t.waitForResponse ? "on" : "off"})`)
  }
  return ids
}

async function patchAgent(toolIds: string[]) {
  const candidates = [AGENT_LLM, ...AGENT_LLM_FALLBACKS]
  let lastError: unknown
  for (const llm of candidates) {
    const body = {
      conversation_config: {
        // One preset per extra language: the browser picks it with overrides.agent.language.
        language_presets: Object.fromEntries(
          AGENT_EXTRA_LANGUAGES.map((code) => [code, { overrides: { agent: { language: code } } }])
        ),
        agent: {
          hinglish_mode: AGENT_HINGLISH_MODE,
          first_message: AGENT_FIRST_MESSAGE,
          dynamic_variables: { dynamic_variable_placeholders: DYNAMIC_VARIABLE_DEFAULTS },
          prompt: {
            prompt: AGENT_SYSTEM_PROMPT,
            llm,
            temperature: AGENT_TEMPERATURE,
            tool_ids: toolIds,
          },
        },
      },
      // Without this the agent ignores the language the browser asks for.
      platform_settings: { overrides: { conversation_config_override: { agent: { language: true } } } },
    }
    if (dry) {
      console.log(`[dry] agent ${AGENT} with llm ${llm}:`, JSON.stringify(body).slice(0, 600), "...")
      return llm
    }
    try {
      await api("PATCH", `/agents/${AGENT}`, body)
      console.log(`updated agent ${AGENT} (llm: ${llm})`)
      return llm
    } catch (e) {
      lastError = e
      // Only a rejected model name is worth retrying with the next candidate.
      if (!(e instanceof ApiError) || e.status !== 422 || !/llm/i.test(e.message)) throw e
      console.warn(`model "${llm}" was rejected, trying the next one`)
    }
  }
  throw lastError
}

async function verify(toolIds: string[]) {
  const agent = await api("GET", `/agents/${AGENT}`)
  const a = agent.conversation_config.agent
  const names: string[] = []
  for (const id of a.prompt.tool_ids ?? []) {
    const t = await api("GET", `/tools/${id}`)
    names.push(`${t.tool_config.name}${t.tool_config.expects_response ? " (waits)" : ""}`)
  }
  const placeholders = Object.keys(a.dynamic_variables?.dynamic_variable_placeholders ?? {})
  const checks: [string, boolean][] = [
    ["prompt uses {{plan}}", a.prompt.prompt.includes("{{plan}}")],
    ["first message uses {{first_question}}", a.first_message.includes("{{first_question}}")],
    ["all tools attached", toolIds.every((id) => (a.prompt.tool_ids ?? []).includes(id))],
    ["placeholders set", placeholders.length === Object.keys(DYNAMIC_VARIABLE_DEFAULTS).length],
    ["hinglish mode", Boolean(a.hinglish_mode) === AGENT_HINGLISH_MODE],
    [
      `language presets: ${AGENT_EXTRA_LANGUAGES.join(", ")}`,
      AGENT_EXTRA_LANGUAGES.every((c) => c in (agent.conversation_config.language_presets ?? {})),
    ],
    [
      "browser may choose the language",
      agent.platform_settings?.overrides?.conversation_config_override?.agent?.language === true,
    ],
  ]
  console.log(`\nagent: ${agent.name} | llm: ${a.prompt.llm} | language: ${a.language} (+ ${AGENT_EXTRA_LANGUAGES.join(", ")})`)
  console.log(`tools: ${names.join(", ")}`)
  console.log(`placeholders: ${placeholders.join(", ")}`)
  for (const [label, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${label}`)
  if (checks.some(([, ok]) => !ok)) process.exit(1)
}

try {
  const check = await api("GET", `/agents/${AGENT}`)
  console.log(`agent found: ${check.name}${dry ? " (dry run: nothing will change)" : ""}`)
  const toolIds = await upsertTools()
  await patchAgent(toolIds)
  if (!dry) await verify(toolIds)
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
