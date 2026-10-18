import { describe, expect, it } from "vitest"
import {
  APPLICANT,
  FACT_IDS,
  formatTable,
  judgeInput,
  parseEval,
  scoreJudgement,
  sideScore,
  simulatorInput,
  summarize,
  verdict,
  withRetry,
  type EvalResult,
  type Judgement,
  type RunResult,
  type SideResult,
} from "@/lib/eval"

const fields = [
  { id: "F1", kind: "text" },
  { id: "F2", kind: "long_text" },
  { id: "F3", kind: "long_text" },
]

function judgement(over: Partial<Judgement> = {}): Judgement {
  return {
    facts: FACT_IDS.map((id) => ({ id, present: id <= 3 })),
    answers: [
      { id: "F1", quality: 5, invented: [] },
      { id: "F2", quality: 4, invented: ["a team of ten"] },
      { id: "F3", quality: 3, invented: [] },
    ],
    ...over,
  }
}

function side(recall: number, quality: number, invented: number, finished = true): SideResult {
  return {
    recalled: Array.from({ length: recall }, (_, i) => i + 1),
    recall,
    quality,
    invented,
    elicited: [],
    turns: 10,
    finished,
    answers: [],
    transcript: [],
  }
}

const run = (n: number, a: SideResult, b: SideResult): RunResult => ({ run: n, baseline: a, bolbharo: b })

function result(summary: EvalResult["summary"]): EvalResult {
  return {
    generatedAt: "2026-10-18T00:00:00.000Z",
    form: "Demo form",
    totalFacts: 8,
    facts: APPLICANT.facts,
    models: { llm: "m", agentLlm: "a" },
    completedRuns: 2,
    failedRuns: 0,
    summary,
    perRun: [],
    notes: [],
  }
}

describe("the simulated applicant", () => {
  it("has eight uniquely numbered facts", () => {
    expect(APPLICANT.facts).toHaveLength(8)
    expect(new Set(FACT_IDS).size).toBe(8)
  })

  it("shows the simulator every fact, and the judge's blank answers as such", () => {
    const sim = JSON.parse(simulatorInput([{ role: "interviewer", text: "Hi" }], "Hi"))
    expect(sim.facts).toHaveLength(8)
    expect(sim.interviewer).toBe("Hi")
    const j = JSON.parse(judgeInput(["I built it"], [{ id: "F1", question: "Q", answer: "  " }]))
    expect(j.questions[0].answer).toBe("(no answer)")
    expect(j.applicantSaid).toEqual(["I built it"])
  })
})

describe("scoreJudgement", () => {
  it("counts recalled facts, clamps quality and lists invented claims", () => {
    const scored = scoreJudgement(
      judgement({ answers: [
        { id: "F1", quality: 9, invented: [] },
        { id: "F2", quality: 0, invented: [" a team of ten ", "a team of ten", ""] },
        { id: "F3", quality: 3, invented: [] },
      ] }),
      FACT_IDS,
      ["F1", "F2", "F3"]
    )
    expect(scored.recalled).toEqual([1, 2, 3])
    expect(scored.quality).toEqual({ F1: 5, F2: 1, F3: 3 })
    expect(scored.invented.F2).toEqual(["a team of ten"])
  })

  it("ignores unknown fact ids and counts a repeated id once", () => {
    const scored = scoreJudgement(
      judgement({ facts: [{ id: 1, present: true }, { id: 1, present: true }, { id: 99, present: true }] }),
      FACT_IDS,
      ["F1", "F2", "F3"]
    )
    expect(scored.recalled).toEqual([1])
  })

  it("throws when the judge skips a question instead of scoring it zero", () => {
    expect(() =>
      scoreJudgement(judgement({ answers: [{ id: "F1", quality: 5, invented: [] }] }), FACT_IDS, ["F1", "F2"])
    ).toThrow(/F2/)
  })

  it("averages quality over long-text questions only", () => {
    const s = sideScore(scoreJudgement(judgement(), FACT_IDS, ["F1", "F2", "F3"]), fields)
    expect(s).toMatchObject({ recall: 3, quality: 3.5, invented: 1 })
  })
})

describe("summarize and verdict", () => {
  const runs = [run(1, side(1, 2, 0), side(7, 4.5, 0)), run(2, side(2, 2.5, 1), side(5, 4, 1, false))]

  it("takes means over the runs and keeps the best and worst", () => {
    const s = summarize(runs)
    expect(s.baseline).toMatchObject({ recall: 1.5, recallMin: 1, recallMax: 2, quality: 2.3, invented: 0.5 })
    expect(s.bolbharo).toMatchObject({ recall: 6, recallMin: 5, recallMax: 7, quality: 4.3, finished: 1 })
  })

  it("handles no runs without dividing by zero", () => {
    expect(summarize([]).bolbharo).toMatchObject({ recall: 0, recallMin: 0, recallMax: 0 })
  })

  it("reports a win, a tie and a loss plainly", () => {
    const at = (a: number, b: number) => summarize([run(1, side(a, 2, 0), side(b, 4, 0))])
    expect(verdict(at(2, 7), 8)).toEqual({ tone: "better", headline: "7 of 8 facts kept. The form-reader kept 2." })
    expect(verdict(at(5, 5), 8).tone).toBe("same")
    const bad = verdict(at(6, 3), 8)
    expect(bad.tone).toBe("worse")
    expect(bad.headline).toContain("Not a win")
  })
})

describe("result file", () => {
  const summary = summarize([run(1, side(1, 2, 0), side(7, 4.5, 0))])

  it("round-trips, and rejects anything that isn't a result", () => {
    const text = JSON.stringify(result(summary))
    expect(parseEval(text)?.form).toBe("Demo form")
    expect(parseEval("not json")).toBeNull()
    expect(parseEval(JSON.stringify({ form: "x" }))).toBeNull()
  })

  it("prints a table with both columns", () => {
    const table = formatTable(result(summary))
    expect(table).toContain("fact recall (of 8)")
    expect(table).toMatch(/baseline\s+BolBharo/)
    expect(table).toMatch(/fact recall \(of 8\)\s+1\s+7/)
  })
})

describe("withRetry", () => {
  it("retries with doubling waits and returns the first success", async () => {
    const waits: number[] = []
    let calls = 0
    const out = await withRetry(
      async () => {
        calls++
        if (calls < 3) throw new Error("busy")
        return "ok"
      },
      { baseMs: 10, sleep: async (ms) => void waits.push(ms) }
    )
    expect(out).toBe("ok")
    expect(waits).toEqual([10, 20])
  })

  it("gives up after the last try and rethrows", async () => {
    await expect(
      withRetry(async () => { throw new Error("down") }, { tries: 2, sleep: async () => {} })
    ).rejects.toThrow("down")
  })
})
