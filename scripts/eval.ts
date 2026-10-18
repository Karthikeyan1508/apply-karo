/**
 * The scoreboard. A naive form-reader (asks each question's label word for word, keeps the first
 * answer) against BolBharo's real ElevenLabs agent (text-only), both interviewing the same simulated
 * applicant who knows eight facts and reveals one only when asked for it specifically. Each side's
 * answers are drafted with draftAnswer, then graded by a Groq judge: facts recalled, answer quality,
 * invented claims. Writes data/eval.json and prints a table. Whatever the run measures is what it
 * reports. Uses Groq and ElevenLabs credit.
 *
 *   npm run eval                 3 runs
 *   npm run eval -- --runs 1     quick check
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { Conversation } from "@elevenlabs/client"
import { buildDynamicVariables, confirmedFacts } from "../lib/core.ts"
import { demoSession } from "../lib/demo.ts"
import {
  APPLICANT,
  FACT_IDS,
  JUDGE_SYSTEM,
  Judgement,
  SIMULATOR_SYSTEM,
  SimReply,
  formatTable,
  judgeInput,
  scoreJudgement,
  sideScore,
  simulatorInput,
  summarize,
  withRetry,
  type EvalResult,
  type RunResult,
  type SideResult,
  type Turn,
} from "../lib/eval.ts"
import { createInterviewStore } from "../lib/interview-store.ts"
import { AGENT_LLM } from "../lib/agent-prompt.ts"
import { draftAnswer, structured } from "../lib/llm.ts"
import { handleFinishInterview, handleRecordAnswers } from "../lib/tools.ts"
import type { FormField } from "../lib/types.ts"
import { agentConnection, loadEnv } from "./env.ts"

const env = loadEnv()
Object.assign(process.env, env)

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const RUNS = Math.max(1, Number(arg("runs") ?? 3) || 3)
const OUT = arg("out") ?? "data/eval.json"
const MAX_TURNS = 24
const SETTLE_MS = 1800

if (!env.GROQ_API_KEY || !env.ELEVENLABS_AGENT_ID) {
  console.error("Set GROQ_API_KEY and ELEVENLABS_AGENT_ID in .env.local first.")
  process.exit(1)
}
const agentId = env.ELEVENLABS_AGENT_ID

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const log = (s: string) => console.log(s)

async function until(cond: () => boolean, ms: number, label: string) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`)
    await wait(150)
  }
}

/** The simulated applicant answers the interviewer's latest message. */
const applicantSays = (transcript: Turn[], interviewer: string) =>
  withRetry(() => structured(SIMULATOR_SYSTEM, simulatorInput(transcript, interviewer), SimReply, "applicant"))

/** Same drafter and same field metadata for both sides, so only the facts differ. */
function draftFor(field: FormField, facts: { slot: string; value: string }[]) {
  if (!facts.length) return Promise.resolve("")
  return withRetry(() =>
    draftAnswer({
      field: {
        label: field.label,
        intent: field.intent,
        kind: field.kind,
        options: field.options,
        multi: field.multi,
        maxChars: field.maxChars,
      },
      facts,
    })
  )
}

interface Interview {
  answers: { field: FormField; answer: string }[]
  transcript: Turn[]
  elicited: Set<number>
  turns: number
  finished: boolean
}

/** The baseline: each form label asked verbatim, the first reply kept as the only fact. */
async function baselineInterview(): Promise<Interview> {
  const form = demoSession()
  const transcript: Turn[] = []
  const elicited = new Set<number>()
  const answers: Interview["answers"] = []
  for (const field of form.fields) {
    transcript.push({ role: "interviewer", text: field.label })
    const sim = await applicantSays(transcript, field.label)
    sim.revealed.forEach((id) => elicited.add(id))
    transcript.push({ role: "applicant", text: sim.reply })
    answers.push({ field, answer: await draftFor(field, [{ slot: "answer", value: sim.reply }]) })
  }
  return { answers, transcript, elicited, turns: form.fields.length, finished: true }
}

/** BolBharo: the real agent, the real client tools, the real quote guard and open-slot gate. */
async function bolbharoInterview(): Promise<Interview> {
  const store = createInterviewStore()
  store.dispatch({ type: "session", session: demoSession() })
  const agentMessages: string[] = []
  const errors: string[] = []

  const conversation = await Conversation.startSession({
    ...(await agentConnection(env)),
    textOnly: true,
    dynamicVariables: buildDynamicVariables(store.getState().session!),
    clientTools: {
      record_answers: (p: Record<string, unknown>) => handleRecordAnswers(store, p.updates),
      finish_interview: () => handleFinishInterview(store),
      edit_answer: () => "error: editing is only available during review",
    },
    onMessage: (m: { role: string; message: string }) => {
      if (m.role === "agent" && m.message) agentMessages.push(m.message)
    },
    onError: (message: string) => errors.push(message),
  })

  /** Everything the agent said since `from`, once it has been quiet for a moment. */
  async function agentTurn(from: number): Promise<string> {
    await until(() => agentMessages.length > from || errors.length > 0, 40_000, "the agent's reply")
    if (errors.length && agentMessages.length <= from) throw new Error(`agent error: ${errors[0]}`)
    let seen = agentMessages.length
    for (;;) {
      await wait(SETTLE_MS)
      if (agentMessages.length === seen) break
      seen = agentMessages.length
    }
    return agentMessages.slice(from).join(" ")
  }

  const transcript: Turn[] = []
  const elicited = new Set<number>()
  let turns = 0
  try {
    let heard = await agentTurn(0)
    let cursor = agentMessages.length
    transcript.push({ role: "interviewer", text: heard })
    while (turns < MAX_TURNS && store.getState().phase === "interview") {
      const sim = await applicantSays(transcript, heard)
      turns++
      sim.revealed.forEach((id) => elicited.add(id))
      transcript.push({ role: "applicant", text: sim.reply })
      // The guard checks quotes against what the user said, so record it before the agent sees it.
      store.dispatch({ type: "utterance", role: "user", text: sim.reply })
      conversation.sendUserMessage(sim.reply)
      heard = await agentTurn(cursor)
      cursor = agentMessages.length
      transcript.push({ role: "interviewer", text: heard })
    }
    await wait(SETTLE_MS + 700) // a record_answers call can land just after the last spoken line
  } finally {
    await conversation.endSession()
  }

  const { session, phase } = store.getState()
  const answers: Interview["answers"] = []
  for (const field of session!.fields) {
    answers.push({
      field,
      answer: await draftFor(field, confirmedFacts(field).map(({ slot, value }) => ({ slot, value }))),
    })
  }
  return { answers, transcript, elicited, turns, finished: phase === "complete" }
}

/** Blind grading: the judge never learns which system wrote the answers. */
async function grade(iv: Interview): Promise<SideResult> {
  const said = iv.transcript.filter((t) => t.role === "applicant").map((t) => t.text)
  const questions = iv.answers.map(({ field, answer }) => ({ id: field.id, question: field.label, answer }))
  const fields = iv.answers.map((a) => a.field)
  const scored = await withRetry(async () => {
    const judgement = await structured(JUDGE_SYSTEM, judgeInput(said, questions), Judgement, "judgement")
    return scoreJudgement(judgement, FACT_IDS, fields.map((f) => f.id))
  })
  return {
    ...sideScore(scored, fields),
    elicited: [...iv.elicited].sort((a, b) => a - b),
    turns: iv.turns,
    finished: iv.finished,
    answers: iv.answers.map(({ field, answer }) => ({
      id: field.id,
      label: field.label,
      kind: field.kind,
      answer,
      quality: scored.quality[field.id],
      invented: scored.invented[field.id],
    })),
    transcript: iv.transcript,
  }
}

async function agentLlmName(): Promise<string> {
  if (!env.ELEVENLABS_API_KEY) return AGENT_LLM
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
    })
    const body = (await res.json()) as { conversation_config?: { agent?: { prompt?: { llm?: string } } } }
    return body.conversation_config?.agent?.prompt?.llm ?? AGENT_LLM
  } catch {
    return AGENT_LLM
  }
}

const runs: RunResult[] = []
const notes: string[] = []
let failed = 0

for (let n = 1; n <= RUNS; n++) {
  log(`\nrun ${n} of ${RUNS}`)
  try {
    log("  baseline ...")
    const baseline = await grade(await baselineInterview())
    log(`    recall ${baseline.recall}/8, quality ${baseline.quality}, invented ${baseline.invented}`)
    log("  BolBharo ...")
    const bolbharo = await grade(await bolbharoInterview())
    log(
      `    recall ${bolbharo.recall}/8, quality ${bolbharo.quality}, invented ${bolbharo.invented}, ` +
        `${bolbharo.turns} turns${bolbharo.finished ? "" : ", NOT finished"}`
    )
    runs.push({ run: n, baseline, bolbharo })
  } catch (e) {
    failed++
    const message = e instanceof Error ? e.message : String(e)
    log(`  run ${n} failed: ${message}`)
    notes.push(`Run ${n} failed and is not counted: ${message}`)
  }
}

if (!runs.length) {
  console.error("\nNo run completed, so there is nothing to write.")
  process.exit(1)
}

const result: EvalResult = {
  generatedAt: new Date().toISOString(),
  form: demoSession().title,
  totalFacts: APPLICANT.facts.length,
  facts: APPLICANT.facts,
  models: { llm: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b", agentLlm: await agentLlmName() },
  completedRuns: runs.length,
  failedRuns: failed,
  summary: summarize(runs),
  perRun: runs,
  notes,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")
console.log(`\n${formatTable(result)}\n\nwritten to ${OUT}`)
process.exit(0)
