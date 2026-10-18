"use client"

import {
  ArrowDownIcon,
  CheckIcon,
  KeyboardIcon,
  Loader2Icon,
  MicIcon,
  MicOffIcon,
  PlayIcon,
  SendHorizontalIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { ShaderOrb } from "@/components/shader/shader-orb"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAgent } from "@/hooks/use-agent"
import { useInterview } from "@/hooks/use-interview"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import type { GuardEvent, Health, TranscriptLine } from "@/lib/types"
import { cn } from "@/lib/utils"
import { PanelHeader } from "./panel-header"
import { slotLabel } from "./slot-chip"

function Status({ label, live }: { label: string; live: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative flex size-2">
        {live && <span className="absolute inline-flex size-full animate-ping bg-brand opacity-70" />}
        <span className={cn("relative inline-flex size-2", live ? "bg-brand" : "bg-muted-foreground/60")} />
      </span>
      {label}
    </span>
  )
}

/** Wraps a control so a disabled button can still explain itself on hover or focus. */
function WithHint({ hint, children }: { hint: string | null; children: React.ReactNode }) {
  if (!hint) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

const BIG = "h-12 px-6 text-[15px] font-semibold"
const RENDER = 330

/** Why the call didn't start or stopped, with the way out that fits the cause. */
function ErrorNotice({ isDemo, retry }: { isDemo: boolean; retry: () => void }) {
  const agent = useAgent()
  const e = agent.error
  if (!e) return null
  return (
    <div role="alert" className="w-full max-w-xl border border-destructive/50 bg-destructive/10 p-4 text-sm">
      <p className="font-semibold text-destructive">{e.title}</p>
      <p className="mt-1 leading-relaxed text-muted-foreground">{e.detail}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {e.kind === "mic" && (
          <Button size="sm" onClick={() => agent.start("text")}>
            <KeyboardIcon /> Type instead
          </Button>
        )}
        {e.kind === "setup" ? (
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/setup" />}>
            Setup guide
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={retry}>
            Try again
          </Button>
        )}
        {isDemo && (
          <Button size="sm" variant="outline" onClick={() => agent.start("demo")}>
            <PlayIcon /> Watch the recorded demo
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={agent.clearError}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}

/**
 * The orb is drawn once at full size and scaled by CSS, so it can shrink into the chat header
 * without redrawing. `box` is the layout size, `scale` how much of the canvas is shown.
 */
function OrbStage({
  box,
  scale,
  ...orb
}: { box: number; scale: number } & Omit<React.ComponentProps<typeof ShaderOrb>, "size">) {
  return (
    <div
      className="relative shrink-0 overflow-hidden transition-[width,height] duration-500"
      style={{ width: box, height: box }}
    >
      <div
        className="absolute top-1/2 left-1/2 transition-transform duration-500"
        style={{ width: RENDER, height: RENDER, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <ShaderOrb {...orb} size={RENDER} />
      </div>
    </div>
  )
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

/** Tags under a user message: what that answer filled, skipped or had blocked by the guard. */
function CapturedTags({ events }: { events: GuardEvent[] }) {
  if (!events.length) return null
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {events.map((e) => (
        <span
          key={e.id}
          className={cn(
            "label-caps animate-in inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] duration-300 fade-in zoom-in-95",
            e.accepted
              ? "border-brand/60 text-brand"
              : "border-destructive/60 bg-destructive/10 text-destructive"
          )}
          title={e.accepted ? (e.update.value ?? "skipped") : e.reason}
        >
          {e.accepted ? <CheckIcon className="size-3" strokeWidth={3} /> : <XIcon className="size-3" strokeWidth={3} />}
          {e.accepted && e.update.skip ? "skipped " : e.accepted ? "" : "blocked "}
          {slotLabel(e.update.slot)}
        </span>
      ))}
    </div>
  )
}

function Message({ line, tags }: { line: TranscriptLine; tags: GuardEvent[] }) {
  const user = line.role === "user"
  return (
    <li className={cn("animate-in flex flex-col gap-1.5 duration-300 fade-in slide-in-from-bottom-1", user ? "items-end" : "items-start")}>
      <div className="label-caps flex items-center gap-2 text-muted-foreground">
        <span className={user ? "" : "text-foreground"}>{user ? "You" : "Apply करो"}</span>
        <span className="mono-caps opacity-60">{time(line.at)}</span>
      </div>
      <p
        className={cn(
          "max-w-[90%] px-4 py-2.5 text-[15px] leading-relaxed",
          user ? "bg-brand font-medium text-brand-foreground" : "bg-foreground/[0.08]"
        )}
      >
        {line.text}
      </p>
      {user && <CapturedTags events={tags} />}
    </li>
  )
}

function Thinking() {
  return (
    <li className="flex flex-col items-start gap-1.5" aria-label="Apply करो is thinking">
      <span className="label-caps text-foreground">Apply करो</span>
      <span className="flex items-center gap-1.5 bg-foreground/[0.08] px-4 py-3.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-pulse bg-brand" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </span>
    </li>
  )
}

/** The interview itself: a stage before it starts, then a chat with the orb as its header. */
export function TalkPanel({ health, className }: { health: Health | null; className?: string }) {
  const agent = useAgent()
  const { session, transcript, guardLog } = useInterview()
  const reduced = useReducedMotion()
  const [draft, setDraft] = useState("")
  const [pinned, setPinned] = useState(true)
  const [tried, setTried] = useState<"voice" | "text">("voice")
  const scroller = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLLIElement>(null)

  const last = transcript[transcript.length - 1]
  const thinking = agent.status === "live" && last?.role === "user" && agent.mode !== "speaking"

  // Each user message owns the guard events that happened after it and before the next user message.
  const tagsByLine = useMemo(() => {
    const map = new Map<string, GuardEvent[]>()
    const users = transcript.filter((t) => t.role === "user")
    users.forEach((u, i) => {
      const until = users[i + 1]?.at ?? Infinity
      map.set(
        u.id,
        guardLog.filter((g) => g.at >= u.at && g.at < until)
      )
    })
    return map
  }, [transcript, guardLog])

  useEffect(() => {
    if (pinned) end.current?.scrollIntoView({ block: "end", behavior: reduced ? "auto" : "smooth" })
  }, [transcript, thinking, pinned, reduced])

  if (!session) return null

  const chatting = transcript.length > 0 || agent.status === "connecting" || agent.status === "live"
  const voiceHint =
    health && !health.voice ? "Voice isn't set up yet. Add ELEVENLABS_AGENT_ID (see /setup)." : null
  const isDemo = session.source === "demo"
  const idle = agent.status === "idle" || agent.status === "ended"

  const label =
    agent.status === "connecting"
      ? "Connecting"
      : agent.status === "live"
        ? agent.channel === "demo"
          ? "Demo replay"
          : agent.mode === "speaking"
            ? "Speaking"
            : "Listening"
        : agent.status === "ended"
          ? "Call ended"
          : "Ready"

  const hint =
    agent.status === "connecting"
      ? "Allow the microphone if your browser asks."
      : agent.status === "ended"
        ? "Start again to carry on from here."
        : agent.channel === "demo"
          ? "Watching a scripted interview."
          : agent.channel === "text"
            ? "Answer in the box below."
            : agent.mode === "speaking"
              ? "Apply करो is speaking."
              : "Go ahead, or type below."

  const begin = (kind: "voice" | "text") => {
    setTried(kind)
    void agent.start(kind)
  }

  const send = (e: React.FormEvent) => {
    e.preventDefault()
    agent.sendText(draft)
    setDraft("")
    setPinned(true)
  }

  const onScroll = () => {
    const el = scroller.current
    if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }

  const startButtons = (
    <>
      <ErrorNotice isDemo={isDemo} retry={() => begin(tried)} />
      <div className="flex flex-wrap justify-center gap-2">
        <WithHint hint={voiceHint}>
          <Button className={BIG} disabled={!!voiceHint} onClick={() => begin("voice")}>
            <MicIcon /> {agent.status === "ended" ? "Talk again" : "Start talking"}
          </Button>
        </WithHint>
        <WithHint hint={voiceHint}>
          <Button variant="outline" className={BIG} disabled={!!voiceHint} onClick={() => begin("text")}>
            <KeyboardIcon /> Type instead
          </Button>
        </WithHint>
        {isDemo && (
          <Button variant="outline" className={BIG} onClick={() => agent.start("demo")}>
            <PlayIcon /> Watch the demo
          </Button>
        )}
      </div>
      {voiceHint && !isDemo && (
        <p className="text-center text-xs text-muted-foreground">
          Voice isn&apos;t set up yet.{" "}
          <Link href="/setup" className="font-semibold text-brand underline underline-offset-4">
            Setup guide
          </Link>
          , or try the demo form.
        </p>
      )}
    </>
  )

  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      <PanelHeader index="02" title="Talk" right={<Status label={label} live={agent.status === "live"} />} />

      {/* Stage: big orb and a headline before the interview, a slim header once it is a chat. */}
      <div
        className={cn(
          "shrink-0 transition-[padding] duration-500",
          chatting
            ? "flex items-center gap-4 border-b px-5 py-2"
            : "flex flex-1 flex-col items-center justify-center gap-4 px-6 py-3"
        )}
      >
        <OrbStage
          box={chatting ? 108 : 310}
          scale={chatting ? 0.46 : 0.94}
          mode={agent.mode}
          status={agent.status}
          getLevels={agent.getLevels}
          getSpectrum={agent.getSpectrum}
        />
        {chatting ? (
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="label-caps text-brand">{label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
          </div>
        ) : (
          <p className="display max-w-md text-center text-4xl text-balance uppercase">
            Just talk. <span className="text-brand">I&apos;ll type.</span>
          </p>
        )}
      </div>

      {chatting && (
        <div className="relative min-h-0 flex-1">
          <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto scroll-smooth px-5 py-4">
            <ol className="flex flex-col gap-4" aria-label="Conversation">
              {transcript.map((t) => (
                <Message key={t.id} line={t} tags={tagsByLine.get(t.id) ?? []} />
              ))}
              {thinking && <Thinking />}
              <li ref={end} aria-hidden="true" className="h-px" />
            </ol>
          </div>
          {!pinned && (
            <button
              type="button"
              onClick={() => setPinned(true)}
              className="label-caps absolute right-4 bottom-3 inline-flex items-center gap-1.5 bg-brand px-3 py-2 text-brand-foreground shadow-lg"
            >
              Latest <ArrowDownIcon className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <div className={cn("flex w-full shrink-0 flex-col items-center gap-3 border-t", chatting ? "p-3" : "p-5")}>
        {idle ? (
          startButtons
        ) : agent.status === "connecting" ? (
          <Button className={BIG} disabled>
            <Loader2Icon className="animate-spin" /> Connecting
          </Button>
        ) : agent.channel === "demo" ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-11 px-5"
              onClick={() => agent.setDemoSpeed(agent.demoSpeed === 1 ? 2 : 1)}
              aria-label="Toggle demo speed"
            >
              {agent.demoSpeed}× speed
            </Button>
            <Button variant="destructive" className="h-11 px-5" onClick={agent.stop}>
              <SquareIcon /> Stop
            </Button>
          </div>
        ) : (
          <form onSubmit={send} className="flex w-full items-center gap-2">
            {agent.channel === "voice" && (
              <Button
                type="button"
                variant="outline"
                className="size-11 shrink-0"
                onClick={() => agent.setMuted(!agent.muted)}
                aria-pressed={agent.muted}
                aria-label={agent.muted ? "Unmute microphone" : "Mute microphone"}
              >
                {agent.muted ? <MicOffIcon /> : <MicIcon />}
              </Button>
            )}
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={agent.channel === "text" ? "Type your answer" : "Or type a reply"}
              aria-label="Type a reply"
              className="h-11 flex-1 px-4 text-[15px]"
              autoFocus={agent.channel === "text"}
            />
            <Button type="submit" className="size-11 shrink-0" aria-label="Send" disabled={!draft.trim()}>
              <SendHorizontalIcon />
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="size-11 shrink-0"
              onClick={agent.stop}
              aria-label="End the conversation"
            >
              <SquareIcon />
            </Button>
          </form>
        )}
      </div>
    </section>
  )
}
