"use client"

import { animate, createScope, stagger } from "animejs"
import {
  ArrowDownIcon,
  ArrowRightIcon,
  CheckIcon,
  ClipboardPasteIcon,
  FileTextIcon,
  Link2Icon,
  Loader2Icon,
  SparklesIcon,
  UploadIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Logo } from "@/components/brand/logo"
import { AccountMenu } from "@/components/account-menu"
import { GoogleMark } from "@/components/brand/google-mark"
import { CopyButton } from "@/components/copy-button"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useHealth } from "@/hooks/use-health"
import { useInterviewStore } from "@/hooks/use-interview"
import { useAuth } from "@/hooks/use-auth"
import { signInWithGoogle } from "@/lib/auth/client"
import { useProfileCount } from "@/hooks/use-profile-count"
import { useSavedSession } from "@/hooks/use-saved-session"
import { reducedMotion } from "@/lib/anim"
import { coverage } from "@/lib/core"
import { prefillFromDocument, uploadDocument, wordsIn, type Doc } from "@/lib/document"
import { ago, clearSaved } from "@/lib/persist"
import { CAPTURE_SNIPPET } from "@/lib/gforms"
import { forgetProfile, prefillFromProfile } from "@/lib/profile"
import type { ApiError, Health, Session } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ProfileCard } from "@/components/profile/profile-card"
import { useView } from "@/components/profile/view"
import { LiveDemo } from "./live-demo"
import { Ticker } from "./ticker"

type SourceTab = "google" | "text" | "demo"
type Lang = "en-IN" | "hi-IN"
type DemoForm = "job" | "merchant"

/** A full page load on purpose: the replay flag is read once per load. */
const replayHref = (lang: Lang) => (lang === "hi-IN" ? "/?replay=1&lang=hi" : "/?replay=1")

const INGEST_STEPS = [
  "Reading your form",
  "Working out what each question is after",
  "Planning the interview",
]

function IngestProgress({ withDoc }: { withDoc: boolean }) {
  const steps = withDoc ? [INGEST_STEPS[0], "Reading your resume", ...INGEST_STEPS.slice(1)] : INGEST_STEPS
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((n) => Math.min(n + 1, steps.length - 1)), 1700)
    return () => clearInterval(id)
  }, [steps.length])
  return (
    <ol className="flex flex-col gap-2.5 border bg-muted p-4 text-sm font-medium" aria-live="polite">
      {steps.map((s, n) => (
        <li key={s} className={cn("flex items-center gap-2.5 transition-opacity duration-500", n > i && "opacity-35")}>
          {n < i ? (
            <CheckIcon className="size-4" strokeWidth={3} />
          ) : n === i ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <span className="size-4 border border-current opacity-50" />
          )}
          {s}
        </li>
      ))}
    </ol>
  )
}

function ResumeBanner() {
  const store = useInterviewStore()
  const saved = useSavedSession()
  if (!saved) return null
  const cov = coverage(saved.state.session)
  return (
    <div className="border border-foreground/50 bg-foreground/[0.07] p-4" role="region" aria-label="Resume where you left off">
      <p className="label-caps text-muted-foreground">Where you left off</p>
      <p className="mt-1 text-[15px] leading-snug font-semibold">{saved.state.session.title}</p>
      <p className="mono-caps mt-1 text-muted-foreground">
        {cov.pct}% done · {ago(saved.savedAt)}
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          className="h-10 px-5 font-semibold"
          onClick={() => store.dispatch({ type: "hydrate", saved: saved.state, savedAt: saved.savedAt })}
        >
          Resume
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 px-4"
          onClick={() => {
            clearSaved()
            toast.success("Saved interview deleted")
          }}
        >
          Discard
        </Button>
      </div>
    </div>
  )
}

/** A private form sends the person away to sign in. This keeps what they typed. */
const PENDING_FORM = "bolbharo.pendingForm"

function SourceCard() {
  const store = useInterviewStore()
  const health = useHealth()
  const auth = useAuth()
  const saved = useProfileCount()
  const [tab, setTab] = useState<SourceTab | null>(null)
  const [url, setUrl] = useState("")
  const [text, setText] = useState("")
  const [context, setContext] = useState("")
  const [showContext, setShowContext] = useState(false)
  const [lang, setLang] = useState<Lang>("en-IN")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError["error"] | null>(null)
  const [demoForm, setDemoForm] = useState<DemoForm>("job")
  const [doc, setDoc] = useState<Doc | null>(null)
  const [docBusy, setDocBusy] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState("")
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const back = sessionStorage.getItem(PENDING_FORM)
      if (!back) return
      sessionStorage.removeItem(PENDING_FORM)
      // Storage can only be read after hydration, so this cannot be the initial state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(back)
      setTab("google")
    } catch {
      // storage blocked: the link just has to be pasted again
    }
  }, [])

  function connectGoogle() {
    try {
      sessionStorage.setItem(PENDING_FORM, url)
    } catch {
      // storage blocked: the link just has to be pasted again
    }
    // A full-page trip: this route handler answers with a redirect to Google, so the router must not handle it.
    if (!auth?.user) void signInWithGoogle()
    else window.location.href = new URL("/api/forms/start", window.location.origin).href
  }

  const active: SourceTab = tab ?? (health?.llm ? "google" : "demo")
  const ready =
    active === "demo" ||
    (active === "google" && url.trim().length > 0) ||
    (active === "text" && text.trim().length >= 10)

  // The merchant demo is spoken in Hindi, so it fixes the language.
  const merchant = active === "demo" && demoForm === "merchant"
  const effectiveLang: Lang = merchant ? "hi-IN" : lang

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: active, demo: demoForm, url, text, context, lang: effectiveLang }),
      })
      const body = (await res.json()) as { session: Session } | ApiError
      if (!res.ok || "error" in body) {
        setError("error" in body ? body.error : { code: "INTERNAL", message: "Something went wrong." })
        return
      }
      let session = await prefillFromProfile(body.session, Boolean(health?.llm))
      if (doc) {
        try {
          session = await prefillFromDocument(session, doc)
        } catch (e) {
          toast.warning("Couldn't use your resume", { description: e instanceof Error ? e.message : undefined })
        }
      }
      store.dispatch({ type: "session", session })
    } catch {
      setError({ code: "NETWORK", message: "Couldn't reach the server. Is it running?" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="reveal surface-lime flex flex-col gap-5 rounded-xl p-6 sm:p-7">
      <ResumeBanner />
      <div className="flex items-start justify-between gap-4">
        <h2 className="display text-4xl uppercase">Pick a form</h2>
        <span className="label-caps mt-1 border border-current px-2 py-1">Step 1</span>
      </div>
      <p className="-mt-2 text-sm leading-relaxed text-muted-foreground">
        Paste a link or the questions. Nothing is submitted until you approve it.
      </p>

      <Tabs value={active} onValueChange={(v) => setTab(v as SourceTab)}>
        <TabsList className="h-11 w-full">
          <TabsTrigger value="google">
            <Link2Icon /> Google Form
          </TabsTrigger>
          <TabsTrigger value="text">
            <ClipboardPasteIcon /> Paste
          </TabsTrigger>
          <TabsTrigger value="demo">
            <SparklesIcon /> Demo
          </TabsTrigger>
        </TabsList>
        <TabsContent value="google" className="pt-4">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/forms/d/e/…/viewform"
            aria-label="Google Form link"
            inputMode="url"
            className="h-12 px-4"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {auth?.configured
              ? "Open to anyone with the link, or sign in with Google for a private form you own."
              : "The form must be open to anyone with the link."}
          </p>
        </TabsContent>
        <TabsContent value="text" className="pt-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Paste the questions, one per line.\nTell us about something you've built (max 100 words)\nWhy do you want this role?"}
            aria-label="Form questions"
            rows={5}
            maxLength={400000}
            className="px-4 py-3"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-foreground/20 pt-3">
            <p className="max-w-[34ch] text-xs leading-relaxed text-muted-foreground">
              Form only for signed-in people? Open it in your browser, press F12, choose Console, paste this, press Enter, then paste the result above.
            </p>
            <CopyButton text={CAPTURE_SNIPPET} label="Copy snippet" />
          </div>
        </TabsContent>
        <TabsContent value="demo" className="pt-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Demo form">
            {(
              [
                ["job", "Job application", "Six questions, English or Hindi"],
                ["merchant", "Merchant loan", "A shopkeeper, in Hinglish"],
              ] as const
            ).map(([id, title, sub]) => (
              <button
                key={id}
                type="button"
                aria-pressed={demoForm === id}
                onClick={() => setDemoForm(id)}
                className={cn(
                  "border p-3 text-left transition-colors",
                  demoForm === id ? "border-foreground bg-foreground text-lime" : "hover:bg-foreground/[0.06]"
                )}
              >
                <span className="block text-sm font-semibold">{title}</span>
                <span className={cn("mt-0.5 block text-xs", demoForm === id ? "opacity-80" : "text-muted-foreground")}>
                  {sub}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            No keys needed: watch a scripted interview, or talk to it yourself.
            {!merchant && (
              <>
                {" "}
                <a href={replayHref(lang)} className="font-semibold text-foreground underline underline-offset-4">
                  No network? Replay the recorded demo.
                </a>
              </>
            )}
          </p>
        </TabsContent>
      </Tabs>

      <div className="border-t border-foreground/20 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="label-caps">
            Your resume <span className="font-normal text-muted-foreground">optional</span>
          </p>
          {!doc && (
            <div className="flex items-center gap-4 text-xs font-semibold">
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.txt,.md,application/pdf,text/plain"
                className="sr-only"
                aria-label="Upload a resume"
                tabIndex={-1}
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (!file) return
                  setDocBusy(true)
                  setDocError(null)
                  try {
                    setDoc(await uploadDocument(file))
                  } catch (err) {
                    setDocError(err instanceof Error ? err.message : "Couldn't read that file.")
                  } finally {
                    setDocBusy(false)
                  }
                }}
              />
              <button
                type="button"
                disabled={docBusy || health?.llm === false}
                onClick={() => fileInput.current?.click()}
                className="inline-flex items-center gap-1.5 underline underline-offset-4 disabled:no-underline disabled:opacity-50"
              >
                <UploadIcon className="size-3.5" /> {docBusy ? "Reading…" : "Upload PDF"}
              </button>
              <button
                type="button"
                disabled={health?.llm === false}
                onClick={() => setPasting((v) => !v)}
                className="underline underline-offset-4 disabled:no-underline disabled:opacity-50"
              >
                Paste text
              </button>
            </div>
          )}
        </div>
        {doc ? (
          <div className="mt-2 flex items-start justify-between gap-3 border bg-muted p-3 text-sm">
            <p className="flex min-w-0 items-start gap-2">
              <FileTextIcon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{doc.name}</span>
                <span className="text-xs text-muted-foreground">
                  {wordsIn(doc.text)} words. Facts are found once and you confirm each one. Not stored.
                </span>
              </span>
            </p>
            <button type="button" aria-label="Remove the resume" onClick={() => setDoc(null)}>
              <XIcon className="size-4" />
            </button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {health?.llm === false
              ? "Needs a Groq key (see Setup)."
              : "Apply करो uses it to answer what it can, then asks only about the gaps."}
          </p>
        )}
        {pasting && !doc && (
          <div className="mt-2 flex flex-col gap-2">
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={5}
              maxLength={60000}
              placeholder="Paste your resume or profile text"
              aria-label="Resume text"
              className="px-3 py-2 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              disabled={pasted.trim().length < 20}
              onClick={() => {
                setDoc({ text: pasted.trim(), name: "your resume" })
                setPasted("")
                setPasting(false)
              }}
            >
              Use this text
            </Button>
          </div>
        )}
        {docError && (
          <p role="alert" className="mt-2 text-xs font-medium text-destructive">
            {docError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex border" role="group" aria-label="Interview language">
          {(
            [
              ["en-IN", "English"],
              ["hi-IN", "हिन्दी"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={effectiveLang === value}
              lang={value === "hi-IN" ? "hi" : "en"}
              onClick={() => {
                setLang(value)
                if (value === "en-IN") setDemoForm("job")
              }}
              className={cn(
                "px-4 py-2 text-xs font-semibold transition-colors",
                effectiveLang === value ? "bg-foreground text-lime" : "text-muted-foreground hover:text-foreground",
                value === "hi-IN" && "font-deva"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowContext((v) => !v)}
          className="text-xs font-semibold underline underline-offset-4"
          aria-expanded={showContext}
        >
          {showContext ? "Hide context" : "Add context"}
        </button>
      </div>

      {showContext && (
        <Textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Paste the job description or product notes. It helps the interview focus on what matters."
          aria-label="Context"
          rows={4}
          maxLength={8000}
          className="animate-in px-4 py-3 duration-300 fade-in slide-in-from-top-1"
        />
      )}

      {error && (
        <div role="alert" className="border border-destructive/50 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">{error.message}</p>
          {error.code === "NETWORK" && (
            <Button size="sm" variant="outline" className="mt-3" render={<a href={replayHref(lang)} />}>
              Replay the recorded demo
            </Button>
          )}
          {error.code === "LLM_NOT_CONFIGURED" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setTab("demo")}>
                Use the demo form
              </Button>
              <Button size="sm" variant="ghost" render={<Link href="/setup" />}>
                Set up keys
              </Button>
            </div>
          )}
          {(error.code === "FORM_PRIVATE" || error.code === "AUTH_EXPIRED") && auth?.configured && (!auth.user || auth.formsAvailable) && (
            <Button type="button" size="sm" className="mt-3 mr-2" onClick={connectGoogle}>
              <GoogleMark /> {auth.user ? "Connect Google Forms" : "Sign in with Google"}
            </Button>
          )}
          {["PARSE_FAILED", "FORM_PRIVATE", "FORM_NEEDS_EDIT_LINK", "FORM_NO_ACCESS", "AUTH_EXPIRED"].includes(error.code) && (
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setTab("text")}>
              Paste the questions instead
            </Button>
          )}
        </div>
      )}

      {busy ? (
        <IngestProgress withDoc={!!doc} />
      ) : (
        <Button type="submit" className="h-12 w-full text-[15px] font-semibold" disabled={!ready}>
          Start the interview <ArrowRightIcon />
        </Button>
      )}

      {saved > 0 && (
        <p className="-mt-1 text-center text-xs text-muted-foreground">
          {saved} saved {saved === 1 ? "fact" : "facts"} on this device will pre-fill matching questions.{" "}
          <button
            type="button"
            className="font-semibold text-foreground underline underline-offset-4"
            onClick={() => {
              void forgetProfile()
              toast.success("Saved facts deleted")
            }}
          >
            Forget them
          </button>
        </p>
      )}
    </form>
  )
}

function StatusRow({ health }: { health: Health | null }) {
  const items = [
    { label: "Form reader", ok: health?.llm, fix: "a Groq key" },
    { label: "Voice agent", ok: health?.voice, fix: "an ElevenLabs agent" },
  ]
  return (
    <div className="label-caps flex flex-wrap items-center gap-x-6 gap-y-2 text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-2">
          <span
            className={cn("size-2", health == null ? "bg-muted-foreground/40" : i.ok ? "bg-brand" : "bg-destructive")}
          />
          {i.label} {health == null ? "…" : i.ok ? "ready" : `needs ${i.fix}`}
        </span>
      ))}
      <Link href="/setup" className="text-foreground underline underline-offset-4">
        Setup guide
      </Link>
    </div>
  )
}

const HOW = [
  {
    n: "01",
    title: "Read",
    body: "Paste a Google Form or the questions. It works out what each one is really after, not just how it is worded.",
  },
  {
    n: "02",
    title: "Ask",
    body: "It interviews you out loud and keeps asking until your answers have names, numbers and outcomes. Never the same question twice.",
  },
  {
    n: "03",
    title: "Prove",
    body: "Every line of every answer sits beside the words you said. Anything you didn't say is blocked. You press submit.",
  },
]

export function Landing() {
  const health = useHealth()
  const view = useView()
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el) return
    if (reducedMotion()) {
      el.querySelectorAll<HTMLElement>(".reveal").forEach((n) => (n.style.opacity = "1"))
      el.querySelectorAll<HTMLElement>(".hero-line").forEach((n) => (n.style.transform = "none"))
      return
    }
    const scope = createScope({ root: el }).add(() => {
      animate(".hero-line", {
        y: ["110%", "0%"],
        delay: stagger(110),
        duration: 900,
        ease: "outExpo",
      })
      animate(".reveal", {
        opacity: [0, 1],
        y: [20, 0],
        delay: stagger(120, { start: 350 }),
        duration: 800,
        ease: "outCubic",
      })
    })
    return () => scope.revert()
  }, [])

  return (
    <div ref={root} className="relative min-h-dvh">
      <Ticker />
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-1 text-sm font-medium">
          <a href="#how" className="hidden px-4 py-2 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:block">
            How it works
          </a>
          <button
            type="button"
            onClick={() => view.open("profile")}
            className="flex items-center gap-1.5 px-3 py-2 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:px-4"
          >
            <UserRoundIcon className="size-4" /> Profile
          </button>
          <Link href="/scoreboard" className="px-3 py-2 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:px-4">
            Scoreboard
          </Link>
          <Link href="/setup" className="hidden px-4 py-2 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:block">
            Setup
          </Link>
          <AccountMenu />
          <ThemeToggle />
        </nav>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-7xl gap-14 px-6 pt-8 pb-24 lg:min-h-[78dvh] lg:grid-cols-12 lg:items-center lg:gap-10">
          <div className="lg:col-span-7">
            <p className="reveal label-caps text-muted-foreground">
              <span className="mono-caps font-semibold text-brand">00</span>
              <span className="mx-2 opacity-40">/</span>Voice interviewer for forms
            </p>
            <h1 className="display mt-6 text-[clamp(3rem,6.5vw,6rem)] whitespace-nowrap uppercase">
              <span className="block overflow-hidden pb-[0.06em]">
                <span className="hero-line block">Talk.</span>
              </span>
              <span className="block overflow-hidden pb-[0.06em]">
                <span className="hero-line block">It fills</span>
              </span>
              <span className="block overflow-hidden pb-[0.06em]">
                <span className="hero-line block text-brand">the form.</span>
              </span>
            </h1>
            <p className="reveal mt-8 max-w-md text-lg leading-relaxed text-muted-foreground">
              Apply करो interviews you out loud, keeps asking until your answers are specific, and
              shows the words behind every line.
            </p>
            <div className="reveal mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
              <a href="#live" className="label-caps inline-flex items-center gap-2 text-foreground underline underline-offset-4">
                See it work <ArrowDownIcon className="size-3.5" />
              </a>
              <span className="label-caps text-muted-foreground">
                English · <span className="font-deva normal-case">हिन्दी</span> · Hinglish
              </span>
            </div>
          </div>
          <div className="lg:col-span-5">
            <SourceCard />
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 pb-16">
          <ProfileCard />
        </section>

        <section id="live" className="mx-auto max-w-7xl scroll-mt-6 px-6 pb-24">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <h2 className="display text-4xl uppercase sm:text-6xl">
              Ask. Capture. <span className="text-brand">Prove.</span>
            </h2>
            <span className="label-caps text-muted-foreground">A real interview, in miniature</span>
          </div>
          <LiveDemo />
        </section>

        <section id="how" className="block-lime scroll-mt-0">
          <ol className="mx-auto grid max-w-7xl md:grid-cols-3">
            {HOW.map((h) => (
              <li
                key={h.n}
                className="border-b border-foreground/25 p-8 pb-12 last:border-b-0 md:border-r md:border-b-0 md:p-10 md:pb-16 md:last:border-r-0"
              >
                <span className="label-caps">Step</span>
                <p className="display mt-3 text-[7rem] leading-none tabular-nums">{h.n}</p>
                <h3 className="display mt-10 text-4xl uppercase">{h.title}</h3>
                <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-muted-foreground">{h.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 pt-10">
          <StatusRow health={health} />
        </div>
        <p
          className="display stroke-text mt-6 translate-y-[0.2em] text-center text-[clamp(3rem,14vw,14rem)] leading-none uppercase opacity-40 select-none"
          aria-hidden="true"
        >
          Apply <span className="font-deva font-extrabold tracking-normal text-brand normal-case [-webkit-text-stroke:0]">करो</span>
        </p>
      </footer>
    </div>
  )
}
