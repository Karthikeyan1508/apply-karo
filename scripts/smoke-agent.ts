/**
 * Talks to your ElevenLabs agent in text-only mode and checks that it does what the app needs:
 * greets with the first question, calls record_answers with real quotes, and never invents one.
 * Uses a little of your ElevenLabs credit. Run it after `npm run configure:agent`.
 *
 *   npm run smoke:agent             English
 *   npm run smoke:agent -- --hi     Hindi form, with a Hinglish reply too
 *
 * Text mode only: it shows the agent follows the language and saves real quotes. It does not
 * exercise speech recognition or the voice.
 */
import { Conversation } from "@elevenlabs/client"
import { agentLanguage, buildDynamicVariables, quoteSupported } from "../lib/core.ts"
import { demoSession } from "../lib/demo.ts"
import { parseUpdates } from "../lib/tools.ts"
import { agentConnection, loadEnv } from "./env.ts"

const hindi = process.argv.includes("--hi")

const agentId = loadEnv().ELEVENLABS_AGENT_ID
if (!agentId) {
  console.error("Set ELEVENLABS_AGENT_ID in .env.local first.")
  process.exit(1)
}

const session = demoSession(hindi ? "hi-IN" : "en-IN")
const said: string[] = []
const agentLines: string[] = []
const calls: { name: string; input: unknown }[] = []
let bad = 0

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms: number, label: string) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`)
    await wait(150)
  }
}

const conversation = await Conversation.startSession({
  ...(await agentConnection(loadEnv())),
  textOnly: true,
  overrides: { agent: { language: agentLanguage(session) } },
  dynamicVariables: buildDynamicVariables(session),
  clientTools: {
    record_answers: ({ updates }: { updates?: string }) => {
      calls.push({ name: "record_answers", input: updates })
      // The app's own parser, so a payload the app would accept is not counted as broken here.
      const parsed = parseUpdates(updates)
      if (!parsed) bad++
      for (const u of parsed ?? []) {
        if (u.quote && !quoteSupported(u.quote, said)) bad++
      }
      return "saved"
    },
    finish_interview: () => {
      calls.push({ name: "finish_interview", input: null })
      return "not done. Still open: F3.what (What did you build?)"
    },
    edit_answer: (p: Record<string, unknown>) => {
      calls.push({ name: "edit_answer", input: p })
      return "updated. The new answer is: Asha"
    },
  },
  onMessage: (m: { role: string; message: string }) => {
    if (m.role === "agent" && m.message) agentLines.push(m.message)
  },
  onError: (message: string) => console.error("agent error:", message),
})

try {
  await until(() => agentLines.length > 0, 25000, "the agent's greeting")
  console.log("agent:", agentLines.at(-1))

  const turns = hindi
    ? [
        "नमस्ते, मैं आशा पाटिल हूँ, पुणे में रहती हूँ।",
        "मैंने पुणे की किराना दुकानों के लिए एक व्हाट्सऐप ऑर्डरिंग बॉट बनाया था। पूरा बैकएंड मैंने खुद पाइथन में लिखा।",
        "Ye bot maine akele banaya, around thirty shop owners isse use karte hain.",
      ]
    : [
        "Hi, I'm Asha Patil, based in Pune.",
        "I built a WhatsApp ordering bot for kirana stores in Pune. I wrote the whole backend myself in Python.",
      ]
  for (const text of turns) {
    const before = agentLines.length
    said.push(text)
    console.log("\nuser: ", text)
    conversation.sendUserMessage(text)
    const callsBefore = calls.length
    await until(() => agentLines.length > before, 30000, "the agent's reply")
    // The tool call can land a moment after the spoken reply.
    await until(() => calls.length > callsBefore, 12000, "record_answers").catch(() =>
      console.log("  (no tool call for this turn)")
    )
    console.log("agent:", agentLines.at(-1))
  }

  console.log("\ntool calls:")
  for (const c of calls) console.log(`  ${c.name}`, typeof c.input === "string" ? c.input : JSON.stringify(c.input))
  const recorded = calls.filter((c) => c.name === "record_answers").length
  console.log(`
${recorded >= turns.length ? "ok  " : "FAIL"} record_answers called for each answer (${recorded} of ${turns.length})`)
  console.log(`${bad === 0 ? "ok  " : "FAIL"} every quote was something the user said (${bad} invented)`)
  const devanagari = agentLines.filter((l) => /[ऀ-ॿ]/.test(l)).length
  if (hindi) {
    console.log(
      `${devanagari === agentLines.length ? "ok  " : "FAIL"} the agent replied in Hindi script (${devanagari} of ${agentLines.length} lines)`
    )
  }
  if (recorded < turns.length || bad || (hindi && devanagari < agentLines.length)) process.exitCode = 1
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await conversation.endSession()
  process.exit(process.exitCode ?? 0)
}
