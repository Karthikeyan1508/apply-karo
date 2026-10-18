"use client"

import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ClipboardPasteIcon, FileTextIcon, Loader2Icon, Link2Icon, UploadIcon, XIcon } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Logo } from "@/components/brand/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useHealth } from "@/hooks/use-health"
import { useInterviewStore } from "@/hooks/use-interview"
import { uploadDocument, wordsIn, type Doc } from "@/lib/document"
import { findGaps, onboardingSession } from "@/lib/profile-gaps"
import { SECTIONS, sectionOf } from "@/lib/profile-keys"
import { loadProfile, pushProfile, saveReviewed, syncEnabled } from "@/lib/profile"
import { useProfileItems } from "@/hooks/use-profile-items"
import { readSources, type OnboardInputs, type ReadStep } from "@/lib/onboard-client"
import type { ProfileItem } from "@/lib/types"
import { cn } from "@/lib/utils"
import { FactCard } from "./fact-card"
import { useView, type OnboardingStart } from "./view"

type Step = "welcome" | "sources" | "reading" | "review" | "done"

const STEP_NUMBER: Record<Step, number> = { welcome: 1, sources: 2, reading: 3, review: 4, done: 5 }
const STEP_NAME: Record<Step, string> = {
  welcome: "Welcome",
  sources: "Add sources",
  reading: "Reading",
  review: "Check facts",
  done: "Done",
}

/** The screen shell shared by onboarding and the profile: logo, a way back, the theme. */
export function ProfileFrame({ children, onBack, backLabel = "Back" }: { children: React.ReactNode; onBack: () => void; backLabel?: string }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="h-9 px-3" onClick={onBack}>
            <ArrowLeftIcon /> {backLabel}
          </Button>
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-16 sm:px-8">
        {children}
      </main>
    </div>
  )
}

function Progress({ step }: { step: Step }) {
  return (
    <p className="label-caps flex items-center gap-2 text-muted-foreground" aria-label={`Step ${STEP_NUMBER[step]} of 5: ${STEP_NAME[step]}`}>
      <span className="mono-caps font-semibold text-brand tabular-nums">
        {String(STEP_NUMBER[step]).padStart(2, "0")}/05
      </span>
      <span className="opacity-40">/</span>
      {STEP_NAME[step]}
    </p>
  )
}

/** A resume or LinkedIn profile: upload a PDF or text file, or paste the text. */
function DocPicker({
  doc,
  onDoc,
  accept,
  pasteTitle,
  uploadLabel,
  name,
}: {
  doc: Doc | null
  onDoc: (doc: Doc | null) => void
  accept: string
  pasteTitle: string
  uploadLabel: string
  name: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState("")

  if (doc) {
    return (
      <div className="flex items-start justify-between gap-3 border bg-muted p-3 text-sm">
        <p className="flex min-w-0 items-start gap-2">
          <FileTextIcon className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{doc.name}</span>
            <span className="text-xs text-muted-foreground">{wordsIn(doc.text)} words, read once and kept only in your profile</span>
          </span>
        </p>
        <Button variant="ghost" size="icon-sm" onClick={() => onDoc(null)} aria-label={`Remove ${name}`}>
          <XIcon />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept={accept}
          className="sr-only"
          tabIndex={-1}
          aria-label={uploadLabel}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (!file) return
            setBusy(true)
            setError(null)
            try {
              onDoc(await uploadDocument(file))
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't read that file.")
            } finally {
              setBusy(false)
            }
          }}
        />
        <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} {busy ? "Reading the file" : uploadLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPasting((v) => !v)} aria-expanded={pasting}>
          <ClipboardPasteIcon /> Paste text
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
      {pasting && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            maxLength={60000}
            placeholder={pasteTitle}
            aria-label={pasteTitle}
            className="px-3 py-2 text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={pasted.trim().length < 20}
            onClick={() => {
              onDoc({ text: pasted.trim(), name })
              setPasted("")
              setPasting(false)
            }}
          >
            Use this text
          </Button>
        </div>
      )}
    </div>
  )
}

function SourceBlock({ title, hint, children, num }: { title: string; hint: string; children: React.ReactNode; num: string }) {
  return (
    <section className="panel flex flex-col gap-4 rounded-xl p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="display text-3xl text-brand tabular-nums">{num}</span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function Welcome({ onStart, onLater }: { onStart: () => void; onLater: () => void }) {
  const points = [
    ["Add what you have", "Your resume, your GitHub and your LinkedIn profile. Any of them is enough to start."],
    ["Check every fact", "Each one shows the words it came from. You edit, remove or mark anything private."],
    ["Answer only the gaps", "Apply करो asks what the sources did not say, by voice or by text. Then forms fill from your profile."],
  ]
  return (
    <div className="flex flex-col gap-8">
      <Progress step="welcome" />
      <div>
        <h1 className="display text-[clamp(2.75rem,8vw,4.5rem)] uppercase">
          Say it once. <span className="text-brand">Reuse it.</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Build a profile from your own documents. Every later form starts filled in, and you still approve each answer.
        </p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {points.map(([title, body], i) => (
          <li key={title} className="panel flex flex-col gap-3 rounded-xl p-5">
            <span className="mono-caps font-semibold text-brand tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
          </li>
        ))}
      </ol>
      <div className="surface-lime flex flex-col gap-2 rounded-xl p-5 text-sm leading-relaxed">
        <p className="font-semibold">Where it is kept</p>
        <p>
          The profile lives in this browser. The side panel is a separate copy, so export it here and import it there.
          Signing in to sync across devices is optional.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button className="h-12 px-6 text-[15px] font-semibold" onClick={onStart}>
          Start <ArrowRightIcon />
        </Button>
        <Button variant="ghost" className="h-12 px-4" onClick={onLater}>
          Not now
        </Button>
      </div>
    </div>
  )
}

function Sources({
  inputs,
  setInputs,
  llm,
  onRead,
  onSkip,
}: {
  inputs: OnboardInputs
  setInputs: (next: OnboardInputs) => void
  llm: boolean
  onRead: () => void
  onSkip: () => void
}) {
  const ready = Boolean(inputs.resume || inputs.linkedin || inputs.github.trim() || inputs.linkedinUrl.trim())
  return (
    <div className="flex flex-col gap-5">
      <Progress step="sources" />
      <div>
        <h1 className="display text-5xl uppercase sm:text-6xl">
          Add what <span className="text-brand">you have.</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Add one or more. More sources give a fuller profile. Nothing is posted anywhere: it is read once, then kept here.
        </p>
      </div>

      {!llm && (
        <p role="status" className="border border-destructive/40 bg-destructive/10 p-3 text-sm">
          Reading needs a Groq key (see Setup). You can still answer the questions by voice or text.
        </p>
      )}

      <SourceBlock num="01" title="Resume" hint="A PDF, TXT or Markdown file, or the text itself.">
        <DocPicker
          doc={inputs.resume}
          onDoc={(resume) => setInputs({ ...inputs, resume })}
          accept=".pdf,.txt,.md,application/pdf,text/plain"
          uploadLabel="Upload resume"
          pasteTitle="Paste your resume text"
          name="your resume"
        />
      </SourceBlock>

      <SourceBlock
        num="02"
        title="GitHub"
        hint="A username or profile link. Apply करो reads your public profile, your top repositories and their READMEs. No sign-in needed."
      >
        <label className="flex flex-col gap-2 text-sm font-medium">
          GitHub username or link
          <Input
            value={inputs.github}
            onChange={(e) => setInputs({ ...inputs, github: e.target.value })}
            placeholder="github.com/your-name"
            autoComplete="off"
            spellCheck={false}
            className="h-11 px-3"
          />
        </label>
      </SourceBlock>

      <SourceBlock
        num="03"
        title="LinkedIn"
        hint="Apply करो does not scrape LinkedIn. On your own profile choose More, then Save to PDF, and upload that file. Or paste your profile text. The profile link is kept as a link only."
      >
        <DocPicker
          doc={inputs.linkedin}
          onDoc={(linkedin) => setInputs({ ...inputs, linkedin })}
          accept=".pdf,.txt,.md,application/pdf,text/plain"
          uploadLabel="Upload LinkedIn PDF"
          pasteTitle="Paste your LinkedIn profile text"
          name="LinkedIn profile"
        />
        <label className="flex flex-col gap-2 text-sm font-medium">
          LinkedIn profile link <span className="font-normal text-muted-foreground">optional</span>
          <Input
            value={inputs.linkedinUrl}
            onChange={(e) => setInputs({ ...inputs, linkedinUrl: e.target.value })}
            placeholder="linkedin.com/in/your-name"
            autoComplete="off"
            spellCheck={false}
            className="h-11 px-3"
          />
        </label>
      </SourceBlock>

      <div className="flex flex-wrap items-center gap-3">
        <Button className="h-12 px-6 text-[15px] font-semibold" disabled={!ready || !llm} onClick={onRead}>
          Read my sources <ArrowRightIcon />
        </Button>
        <Button variant="ghost" className="h-12 px-4" onClick={onSkip}>
          Skip, answer the questions
        </Button>
      </div>
    </div>
  )
}

function Reading({ steps, current, error, onRetry, onSkip }: { steps: { id: ReadStep; label: string }[]; current: ReadStep | "done" | null; error: string | null; onRetry: () => void; onSkip: () => void }) {
  const order = steps.map((s) => s.id)
  const at = current === "done" ? steps.length : current ? order.indexOf(current) : 0
  return (
    <div className="flex flex-col gap-6">
      <Progress step="reading" />
      <h1 className="display text-5xl uppercase">
        Reading <span className="text-brand">your sources.</span>
      </h1>
      <ol className="panel flex flex-col gap-3 rounded-xl p-5 text-sm font-medium" aria-live="polite">
        {steps.map((s, n) => (
          <li key={s.id} className={cn("flex items-center gap-3 transition-opacity duration-300", n > at && "opacity-40")}>
            {n < at ? (
              <CheckIcon className="size-4" strokeWidth={3} />
            ) : n === at && !error ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <span className="size-4 border border-current opacity-50" />
            )}
            {s.label}
          </li>
        ))}
      </ol>
      {error ? (
        <div role="alert" className="flex flex-col gap-3 border border-destructive/50 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">{error}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onRetry}>
              Back to sources
            </Button>
            <Button size="sm" variant="ghost" onClick={onSkip}>
              Answer the questions instead
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This takes about a minute for a long resume.</p>
      )}
    </div>
  )
}

function Review({
  facts,
  setFacts,
  notes,
  onSave,
  onSaveOnly,
}: {
  facts: ProfileItem[]
  setFacts: (next: ProfileItem[]) => void
  notes: string[]
  onSave: () => void
  onSaveOnly: () => void
}) {
  const bySection = SECTIONS.map((s) => ({ s, items: facts.map((f, i) => ({ f, i })).filter(({ f }) => sectionOf(f) === s) }))
    .filter((g) => g.items.length)
  const update = (i: number, patch: Partial<ProfileItem>) => setFacts(facts.map((f, n) => (n === i ? { ...f, ...patch } : f)))
  const remove = (i: number) => setFacts(facts.filter((_, n) => n !== i))
  const usable = facts.filter((f) => f.value.trim())

  return (
    <div className="flex flex-col gap-6">
      <Progress step="review" />
      <div>
        <h1 className="display text-5xl uppercase sm:text-6xl">
          Check what we <span className="text-brand">found.</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Each fact shows the words it came from. Edit or remove anything wrong. Mark anything private as sensitive:
          it is then only filled in when you say so.
        </p>
      </div>

      {notes.map((n) => (
        <p key={n} role="status" className="border bg-muted p-3 text-sm">
          {n}
        </p>
      ))}

      {facts.length === 0 ? (
        <p className="panel rounded-xl p-6 text-sm leading-relaxed text-muted-foreground">
          We found nothing we can use yet. You will be asked the questions instead.
        </p>
      ) : (
        bySection.map(({ s, items }) => (
          <section key={s} className="flex flex-col gap-3" aria-labelledby={`sec-${s}`}>
            <h2 id={`sec-${s}`} className="label-caps flex items-center gap-2 text-muted-foreground">
              {s} <span className="mono-caps tabular-nums">{items.length}</span>
            </h2>
            {items.map(({ f, i }) => (
              <FactCard key={`${f.label}|${f.slot}`} fact={f} mode="review" onChange={(p) => update(i, p)} onRemove={() => remove(i)} />
            ))}
          </section>
        ))
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/90 px-4 py-4 backdrop-blur sm:-mx-8 sm:px-8">
        <span className="label-caps text-muted-foreground tabular-nums">{usable.length} to save</span>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11 px-4" onClick={onSaveOnly}>
            Save, skip questions
          </Button>
          <Button className="h-11 px-5 font-semibold" onClick={onSave}>
            Save and answer the rest <ArrowRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}

function Done({ count, sections, onOpen, onHome }: { count: number; sections: Record<string, number>; onOpen: () => void; onHome: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <Progress step="done" />
      <div>
        <h1 className="display text-5xl uppercase sm:text-6xl">
          Profile <span className="text-brand">saved.</span>
        </h1>
        <p className="mt-4 text-lg">
          {count} {count === 1 ? "fact" : "facts"} saved on this device.
        </p>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Matching forms now start filled in. You will only be asked what is still missing, and you still approve every answer.
        </p>
      </div>
      <ul className="panel grid grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-3">
        {SECTIONS.filter((s) => sections[s]).map((s) => (
          <li key={s} className="flex items-center justify-between gap-3 bg-background/60 p-4 text-sm">
            <span>{s}</span>
            <span className="mono-caps font-semibold tabular-nums">{sections[s]}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button className="h-12 px-6 font-semibold" onClick={onOpen}>
          Open my profile
        </Button>
        <Button variant="outline" className="h-12 px-5" onClick={onHome}>
          Back to start
        </Button>
      </div>
    </div>
  )
}

function countSections(facts: readonly ProfileItem[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of facts) {
    const s = sectionOf(f)
    out[s] = (out[s] ?? 0) + 1
  }
  return out
}

/** Onboarding: welcome, sources, a read with visible progress, a review of what was found, the gap interview, done. */
export function Onboarding() {
  const view = useView()
  const store = useInterviewStore()
  const health = useHealth()
  const llm = health?.llm !== false
  const [step, setStep] = useState<Step>(view.start === "sources" ? "sources" : "welcome")
  const [inputs, setInputs] = useState<OnboardInputs>({ resume: null, linkedin: null, github: "", linkedinUrl: "" })
  const [steps, setSteps] = useState<{ id: ReadStep; label: string }[]>([])
  const [current, setCurrent] = useState<ReadStep | "done" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [facts, setFacts] = useState<ProfileItem[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const saved = useProfileItems()

  const back: OnboardingStart = "welcome"
  const leave = () => view.open("home", back)

  async function read() {
    const planned: { id: ReadStep; label: string }[] = []
    if (inputs.github.trim()) planned.push({ id: "github", label: "Looking at your GitHub" })
    if (inputs.resume || inputs.linkedin) {
      const what = [inputs.resume && "your resume", inputs.linkedin && "your LinkedIn"].filter(Boolean).join(" and ")
      planned.push({ id: "facts", label: `Reading ${what}` })
    } else {
      planned.push({ id: "facts", label: "Checking your links" })
    }
    setSteps(planned)
    setError(null)
    setCurrent(null)
    setStep("reading")
    try {
      const result = await readSources(inputs, (s) => setCurrent(s))
      setCurrent("done")
      setFacts(result.facts)
      setNotes(result.notes)
      setStep("review")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while reading.")
    }
  }

  /** Save the reviewed facts, then either start the gap questions or go straight to done. */
  function save(startQuestions: boolean, list: ProfileItem[] = facts) {
    const count = saveReviewed(list.filter((f) => f.value.trim()))
    if (count === null) {
      toast.error("Couldn't save", { description: "This browser is blocking storage, so the profile can't be kept." })
      return
    }
    if (syncEnabled()) void pushProfile()
    const gaps = startQuestions ? findGaps(loadProfile()) : []
    if (gaps.length) {
      store.dispatch({ type: "session", session: onboardingSession(gaps) })
      view.open("home")
      return
    }
    setStep("done")
  }

  return (
    <ProfileFrame onBack={leave} backLabel="Close">
      {step === "welcome" && <Welcome onStart={() => setStep("sources")} onLater={leave} />}
      {step === "sources" && (
        <Sources inputs={inputs} setInputs={setInputs} llm={llm} onRead={read} onSkip={() => save(true, [])} />
      )}
      {step === "reading" && (
        <Reading
          steps={steps}
          current={current}
          error={error}
          onRetry={() => setStep("sources")}
          onSkip={() => save(true, [])}
        />
      )}
      {step === "review" && (
        <Review facts={facts} setFacts={setFacts} notes={notes} onSave={() => save(true)} onSaveOnly={() => save(false)} />
      )}
      {step === "done" && (
        <Done
          count={saved.length}
          sections={countSections(saved)}
          onOpen={() => view.open("profile")}
          onHome={leave}
        />
      )}
    </ProfileFrame>
  )
}
