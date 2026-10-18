/**
 * Does the live agent hear Hindi? Synthesises a few Hindi and Hinglish sentences with ElevenLabs
 * text to speech, streams the audio into the agent over its conversation WebSocket (the same path a
 * microphone takes), and prints what the agent's speech recognition transcribed next to what was said.
 *
 *   npm run check:speech
 *
 * What this proves and what it doesn't: it exercises the real recogniser behind the agent, with the
 * Hindi language preset applied. The speaker is a synthetic voice, so it says nothing about accents,
 * background noise or a real microphone. Uses a little ElevenLabs credit.
 */
import { agentLanguage, buildDynamicVariables, norm } from "../lib/core.ts"
import { demoSession } from "../lib/demo.ts"
import { agentConnection, loadEnv } from "./env.ts"

const env = loadEnv()
const KEY = env.ELEVENLABS_API_KEY
const AGENT = env.ELEVENLABS_AGENT_ID
if (!KEY || !AGENT) {
  console.error("Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in .env.local first.")
  process.exit(1)
}

/**
 * Devanagari lines are scored by how many of their words come back. A Hinglish line spoken from Roman
 * letters may legitimately come back in Devanagari, so it is scored on the English words it must keep.
 */
const LINES: { text: string; mustHave?: string[] }[] = [
  { text: "मैं आशा पाटिल हूँ और पुणे में रहती हूँ।" },
  { text: "मैंने किराना दुकानों के लिए एक व्हाट्सऐप ऑर्डरिंग बॉट बनाया था।" },
  { text: "करीब तीस दुकानदार इस्तेमाल करते हैं।" },
  { text: "Maine kirana stores ke liye ek WhatsApp ordering bot banaya tha.", mustHave: ["whatsapp", "ordering", "bot"] },
]

const SAMPLE_RATE = 16000
const CHUNK_MS = 250
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function voiceId(): Promise<string> {
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT}`, { headers: { "xi-api-key": KEY! } })
  const body = (await res.json()) as { conversation_config?: { tts?: { voice_id?: string } } }
  const id = body.conversation_config?.tts?.voice_id
  if (!id) throw new Error(`couldn't read the agent's voice (${res.status})`)
  return id
}

/** 16 kHz, 16-bit mono PCM of the sentence, spoken in Hindi. */
async function speak(text: string, voice: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=pcm_16000`, {
    method: "POST",
    headers: { "xi-api-key": KEY!, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", language_code: "hi" }),
  })
  if (!res.ok) throw new Error(`text to speech failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Share of the expected words the transcript contains, ignoring punctuation and case. */
function overlap(expected: string[], heard: string): number {
  const have = new Set(norm(heard).split(" "))
  return expected.filter((w) => have.has(w)).length / expected.length
}

const session = demoSession("hi-IN")
const voice = await voiceId()
const audio = await Promise.all(LINES.map((l) => speak(l.text, voice)))

const link = await agentConnection(env)
const ws = new WebSocket(
  "signedUrl" in link
    ? link.signedUrl
    : `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(link.agentId)}`
)
const transcripts: string[] = []
const replies: string[] = []

ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data))
  if (m.type === "ping") ws.send(JSON.stringify({ type: "pong", event_id: m.ping_event.event_id }))
  else if (m.type === "user_transcript") transcripts.push(m.user_transcription_event.user_transcript)
  else if (m.type === "agent_response") replies.push(m.agent_response_event.agent_response)
  else if (m.type === "client_tool_call") {
    const c = m.client_tool_call
    ws.send(JSON.stringify({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: "saved", is_error: false }))
  }
}
await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve()
  ws.onerror = () => reject(new Error("couldn't open the agent's WebSocket"))
})
ws.send(
  JSON.stringify({
    type: "conversation_initiation_client_data",
    conversation_config_override: { agent: { language: agentLanguage(session) } },
    dynamic_variables: buildDynamicVariables(session),
  })
)

async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) return false
    await wait(100)
  }
  return true
}

let failed = 0
try {
  if (!(await until(() => replies.length > 0, 20_000))) throw new Error("the agent never greeted")
  await wait(4000) // let the greeting's audio play out so it isn't mixed with ours
  console.log(`agent: ${replies[0]}\n`)

  for (const [i, { text, mustHave }] of LINES.entries()) {
    const heardBefore = transcripts.length
    const pcm = audio[i]
    const step = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000
    // Real-time pacing, then a second of silence so the recogniser ends the turn.
    const padded = Buffer.concat([pcm, Buffer.alloc(SAMPLE_RATE * 2)])
    for (let at = 0; at < padded.length; at += step) {
      ws.send(JSON.stringify({ user_audio_chunk: padded.subarray(at, at + step).toString("base64") }))
      await wait(CHUNK_MS)
    }
    const got = await until(() => transcripts.length > heardBefore, 12_000)
    await wait(2500) // let the agent's reply land before the next sentence
    const heard = transcripts.slice(heardBefore).join(" ")
    const score = got ? overlap(mustHave ?? norm(text).split(" "), heard) : 0
    if (score < 0.6) failed++
    console.log(`said:  ${text}\nheard: ${got ? heard : "(nothing)"}\nwords matched: ${Math.round(score * 100)}%\n`)
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  failed++
} finally {
  ws.close()
}
console.log(
  failed
    ? `${failed} of ${LINES.length} sentences were not transcribed closely enough (under 60% of words).`
    : `All ${LINES.length} sentences came back with at least 60% of their words. Synthetic voice only.`
)
process.exit(failed ? 1 : 0)
