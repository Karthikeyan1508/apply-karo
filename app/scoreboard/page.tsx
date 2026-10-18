import { ArrowLeftIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Logo } from "@/components/brand/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { PanelHeader } from "@/components/workspace/panel-header"
import { fmt, parseEval, verdict, type EvalResult, type SideResult } from "@/lib/eval"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Scoreboard | Apply करो" }
// Read per request, so a fresh `npm run eval` shows up without a rebuild.
export const dynamic = "force-dynamic"

async function load(): Promise<EvalResult | null> {
  try {
    return parseEval(await readFile(path.join(process.cwd(), "data", "eval.json"), "utf8"))
  } catch {
    return null
  }
}

function Metric({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 border-t px-5 py-5 first:border-t-0">
      <p className="label-caps text-muted-foreground">{label}</p>
      <p className="display flex items-baseline gap-2 text-[clamp(4.5rem,11vw,9rem)] leading-[0.9] tabular-nums">
        {value}
        {unit && <span className="display text-[clamp(1.5rem,3vw,2.5rem)] text-muted-foreground">{unit}</span>}
      </p>
      {note && <p className="mono-caps text-muted-foreground">{note}</p>}
    </div>
  )
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${fmt(Math.abs(Math.round(n * 10) / 10))}`

function Scorecard({
  tone,
  index,
  title,
  caption,
  score,
  versus,
  total,
}: {
  tone: "plain" | "lime"
  index: string
  title: string
  caption: string
  score: EvalResult["summary"]["baseline"]
  /** Present on the Apply करो card: the baseline, to show the gap. */
  versus?: EvalResult["summary"]["baseline"]
  total: number
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-1 flex-col rounded-xl",
        tone === "lime" ? "surface-lime" : "panel"
      )}
      aria-label={title}
    >
      <PanelHeader index={index} title={title} right={<span className="hidden sm:inline">{caption}</span>} />
      <Metric
        label="Facts recalled"
        value={fmt(score.recall)}
        unit={`/ ${total}`}
        note={versus ? `${signed(score.recall - versus.recall)} against the form-reader` : `best ${score.recallMax}, worst ${score.recallMin}`}
      />
      <Metric
        label="Answer quality"
        value={fmt(score.quality)}
        unit="/ 5"
        note={versus ? `${signed(score.quality - versus.quality)} against the form-reader` : "mean of the long answers"}
      />
      <Metric
        label="Invented claims"
        value={fmt(score.invented)}
        note={versus ? `${signed(score.invented - versus.invented)} against the form-reader` : "not in what the applicant said"}
      />
    </section>
  )
}

/** How many of the runs recalled each fact, for one side. */
const recalledIn = (runs: EvalResult["perRun"], side: "baseline" | "bolbharo", id: number) =>
  runs.filter((r) => r[side].recalled.includes(id)).length

function Mark({ n, of }: { n: number; of: number }) {
  return (
    <span
      className={cn(
        "mono-caps inline-flex w-14 shrink-0 justify-center border px-1.5 py-1 tabular-nums",
        n === of && of > 0
          ? "border-brand bg-brand text-brand-foreground"
          : n > 0
            ? "border-brand text-brand"
            : "text-muted-foreground"
      )}
      aria-label={`recalled in ${n} of ${of} runs`}
    >
      {n}/{of}
    </span>
  )
}

function AnswerCard({ title, side, fieldId }: { title: string; side: SideResult; fieldId: string }) {
  const a = side.answers.find((x) => x.id === fieldId)
  return (
    <div className="panel flex min-w-0 flex-1 flex-col gap-3 rounded-xl p-5">
      <p className="label-caps text-muted-foreground">{title}</p>
      <p className="text-[17px] leading-relaxed">{a?.answer.trim() || "(no answer)"}</p>
      <p className="mono-caps mt-auto pt-2 text-muted-foreground">
        quality {a?.quality ?? "-"} / 5 · {a?.invented.length ?? 0} invented
      </p>
    </div>
  )
}

function Empty() {
  return (
    <div className="panel mt-10 flex flex-col gap-4 rounded-xl p-6 sm:p-8">
      <p className="display text-4xl uppercase">No scoreboard yet</p>
      <p className="max-w-xl leading-relaxed text-muted-foreground">
        The numbers on this page come from a real run, never from a template. Run the evaluation once and
        reload. It needs a Groq key and the ElevenLabs agent from the setup guide, and uses a little of both.
      </p>
      <pre className="border bg-foreground/[0.06] p-4 font-mono text-sm">npm run eval</pre>
      <Link href="/setup" className="label-caps self-start text-foreground underline underline-offset-4">
        Setup guide
      </Link>
    </div>
  )
}

export default async function ScoreboardPage() {
  const result = await load()
  const long = result?.perRun[0]?.bolbharo.answers.find((a) => a.kind === "long_text")
  const v = result ? verdict(result.summary, result.totalFacts) : null

  return (
    <div className="relative min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" aria-label="Apply करो home">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" /> Back to the app
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-6 pt-6 pb-24">
        <p className="label-caps text-muted-foreground">
          <span className="mono-caps font-semibold text-brand">03</span>
          <span className="mx-2 opacity-40">/</span>Scoreboard
        </p>
        <h1 className="display mt-5 text-[clamp(2rem,6.2vw,5.75rem)] uppercase">
          Same applicant.
          <br />
          <span className="text-brand">Two interviewers.</span>
        </h1>

        {!result || !v ? (
          <Empty />
        ) : (
          <>
            <p className="mt-8 max-w-2xl text-xl leading-snug font-semibold text-balance">{v.headline}</p>
            <p className="label-caps mt-3 text-muted-foreground">
              {result.completedRuns} {result.completedRuns === 1 ? "run" : "runs"}
              {result.failedRuns ? `, ${result.failedRuns} failed and not counted` : ""} · {result.form} ·{" "}
              {new Date(result.generatedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}
            </p>

            <div className="mt-10 flex flex-col gap-4 lg:flex-row lg:gap-6">
              <Scorecard
                tone="plain"
                index="A"
                title="Form-reader"
                caption="asks each label, keeps the first answer"
                score={result.summary.baseline}
                total={result.totalFacts}
              />
              <Scorecard
                tone="lime"
                index="B"
                title="Apply करो"
                caption="the real agent, probing"
                score={result.summary.bolbharo}
                versus={result.summary.baseline}
                total={result.totalFacts}
              />
            </div>

            <section className="mt-20" aria-labelledby="ledger">
              <h2 id="ledger" className="display text-4xl uppercase sm:text-5xl">
                What each one <span className="text-brand">kept</span>
              </h2>
              <p className="mt-3 max-w-xl text-muted-foreground">
                Eight facts the applicant knows and gives up only when asked for them. Each mark counts the
                runs in which the fact reached the final answers.
              </p>
              <div className="label-caps mt-8 flex items-center gap-4 border-b pb-2 text-muted-foreground">
                <span className="flex-1">Fact</span>
                <span className="w-14 text-center">Reader</span>
                <span className="w-14 text-center">Apply करो</span>
              </div>
              <ol>
                {result.facts.map((f) => (
                  <li key={f.id} className="flex items-center gap-4 border-b py-3.5">
                    <span className="mono-caps w-6 shrink-0 text-brand">{String(f.id).padStart(2, "0")}</span>
                    <p className="min-w-0 flex-1 text-[15px] leading-snug">{f.text}</p>
                    <Mark n={recalledIn(result.perRun, "baseline", f.id)} of={result.perRun.length} />
                    <Mark n={recalledIn(result.perRun, "bolbharo", f.id)} of={result.perRun.length} />
                  </li>
                ))}
              </ol>
            </section>

            {long && result.perRun[0] && (
              <section className="mt-20" aria-labelledby="answers">
                <h2 id="answers" className="display text-4xl uppercase sm:text-5xl">
                  One question, <span className="text-brand">two answers</span>
                </h2>
                <p className="mt-3 max-w-xl text-muted-foreground">
                  “{long.label}” in run 1, written by the same drafter from what each interview drew out.
                </p>
                <div className="mt-8 flex flex-col gap-4 md:flex-row md:gap-6">
                  <AnswerCard title="Form-reader" side={result.perRun[0].baseline} fieldId={long.id} />
                  <AnswerCard title="Apply करो" side={result.perRun[0].bolbharo} fieldId={long.id} />
                </div>
              </section>
            )}

            <section className="block-lime mt-20 rounded-xl border border-forest p-6 sm:p-8" aria-labelledby="how">
              <h2 id="how" className="display text-3xl uppercase sm:text-4xl">
                How this was measured
              </h2>
              <ol className="mt-5 flex max-w-3xl list-decimal flex-col gap-2.5 pl-5 text-[15px] leading-relaxed marker:font-mono">
                <li>
                  A simulated applicant ({result.models.llm} on Groq) knows eight facts and is vague on purpose.
                  It reveals a fact only when the question asks for that detail.
                </li>
                <li>
                  The form-reader asks each question exactly as the form words it and keeps the first answer.
                  Apply करो is the live ElevenLabs agent ({result.models.agentLlm}) in text mode, with the real
                  tools, quote guard and open-slot check.
                </li>
                <li>
                  Both sets of answers come from the same drafter, with the same notes on each question. The
                  judge scores facts, quality and invented claims without being told which tool wrote them.
                </li>
                <li>
                  Quality is the mean of the long-text answers, 1 to 5. An invented claim is anything in an
                  answer the applicant did not say.
                </li>
                <li>
                  Limits: one model family plays the applicant, drafts and judges, so it may favour its own
                  style. The plan is the hand-written demo plan, not one generated from a form. A few runs
                  show the size of the gap, not a statistical test.
                </li>
                {result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ol>
              <p className="label-caps mt-6">
                Reproduce: <code className="font-mono normal-case">npm run eval</code>
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
