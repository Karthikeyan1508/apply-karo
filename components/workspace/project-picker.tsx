"use client"

import { CheckIcon, KeyboardIcon, Loader2Icon, LockIcon, MicIcon, PenLineIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { extensionOrigin, useEmbedded } from "@/components/extension-bridge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAgent } from "@/hooks/use-agent"
import { useInterview, useInterviewStore } from "@/hooks/use-interview"
import { openSlots } from "@/lib/core"
import { loadRepos, projectFills, repoSummary } from "@/lib/github-client"
import { autofillPayload } from "@/lib/page-form"
import { mainQuestions, rankRepos, type Repo } from "@/lib/repos"
import { cn } from "@/lib/utils"

const MAX_PICKS = 3
const SHOWN = 12

/**
 * In the chat: the form asks about the person's projects, and their GitHub is connected, so ask which repos to
 * use. The chosen repos answer what they can, and what they cannot answer is left for the interview.
 */
export function ProjectPicker({ className }: { className?: string }) {
  const store = useInterviewStore()
  const agent = useAgent()
  const embedded = useEmbedded()
  const { session, drafting } = useInterview()
  const [picked, setPicked] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [all, setAll] = useState(false)
  const repos = useMemo(() => rankRepos(loadRepos()), [])

  const choice = session?.projectChoice
  const field = session?.fields.find((f) => f.id === choice?.fieldId)
  if (!session || !choice || !field || choice.stage === "skipped") return null

  const q = query.trim().toLowerCase()
  const matching = repos.filter((r) => !q || `${r.name} ${r.description} ${r.language}`.toLowerCase().includes(q))
  const list = q || all ? matching : matching.slice(0, SHOWN)

  const toggle = (full: string) =>
    setPicked((p) => (p.includes(full) ? p.filter((x) => x !== full) : p.length >= MAX_PICKS ? p : [...p, full]))

  async function use() {
    if (!session || !choice) return
    const chosen = picked.map((full) => repos.find((r) => r.full === full)).filter((r): r is Repo => Boolean(r))
    store.dispatch({ type: "projects", choice: { ...choice, stage: "working", repos: picked } })
    try {
      const fills = await projectFills(session, choice.fieldId, chosen)
      store.dispatch({ type: "prefill", fills })
      const now = store.getState().session ?? session
      const open = openSlots(now).filter((o) => o.fieldId === choice.fieldId)
      // Only the main questions are asked; the other parts are left out rather than interrogating the person.
      const ask = mainQuestions(open)
      const skip = open.filter((o) => !ask.includes(o)).map((o) => o.slot)
      const summaries = chosen.map((r) => ({ repo: r.name, text: repoSummary(r) })).filter((s) => s.text)
      store.dispatch({
        type: "projects",
        skip,
        choice: { ...choice, stage: "done", repos: picked, leftover: ask.map((o) => o.ask), summaries },
      })
    } catch {
      toast.error("Couldn't read those repos. Try again, or skip and describe it yourself.")
      store.dispatch({ type: "projects", choice: { ...choice, stage: "ask", repos: [] } })
    }
  }

  const fillPage = () => {
    const parent = extensionOrigin()
    const mine = autofillPayload(session).filter((p) => p.ref === field.entryId)
    if (!parent || !mine.length) return toast.message("Nothing to fill yet. Give it a moment, or answer the rest first.")
    window.parent.postMessage({ type: "bolbharo:fill", fields: mine }, parent)
  }

  const names = choice.repos.map((full) => full.split("/")[1] ?? full).join(", ")
  const writing = drafting.includes(field.id)

  return (
    <section aria-label="Choose repositories" className={cn("w-full border-t bg-foreground/[0.03] p-4 text-sm", className)}>
      <p className="label-caps text-muted-foreground">Apply करो</p>

      {choice.stage === "ask" && (
        <>
          <p className="mt-1.5 leading-snug font-semibold">Which of your repos should I use for this?</p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">“{field.label}” Pick up to {MAX_PICKS}.</p>
          {repos.length > 8 && (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your repos"
              aria-label="Search your repos"
              className="mt-3 h-9 px-3"
            />
          )}
          <ul className="mt-3 flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
            {list.map((r) => {
              const on = picked.includes(r.full)
              return (
                <li key={r.full}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={!on && picked.length >= MAX_PICKS}
                    onClick={() => toggle(r.full)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-[3px] border px-3 py-2 text-left transition-colors disabled:opacity-50",
                      on ? "border-brand bg-brand/15" : "hover:bg-muted"
                    )}
                  >
                    <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-[2px] border", on && "border-transparent bg-brand text-brand-foreground")}>
                      {on && <CheckIcon className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <span className="truncate">{r.name}</span>
                        {r.private && <LockIcon className="size-3 shrink-0 text-muted-foreground" aria-label="private" />}
                      </span>
                      {(r.description || r.language) && (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {[r.description, r.language].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
            {!list.length && <li className="text-xs text-muted-foreground">No repo matches that.</li>}
          </ul>
          {!q && !all && matching.length > SHOWN && (
            <button type="button" className="mt-2 text-xs underline underline-offset-4" onClick={() => setAll(true)}>
              Show all {matching.length}
            </button>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={!picked.length} onClick={use}>
              Use {picked.length || ""} {picked.length === 1 ? "repo" : "repos"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => store.dispatch({ type: "projects", choice: { ...choice, stage: "skipped" } })}>
              Skip, I will describe it
            </Button>
          </div>
        </>
      )}

      {choice.stage === "working" && (
        <p className="mt-1.5 flex items-center gap-2 font-semibold">
          <Loader2Icon className="size-4 animate-spin" /> Reading {names}…
        </p>
      )}

      {choice.stage === "done" && (
        <>
          <p className="mt-1.5 leading-snug font-semibold">Used {names}.</p>
          {choice.summaries?.map((s) => (
            <p key={s.repo} className="mt-1.5 text-xs leading-snug">
              <span className="font-semibold">{s.repo}:</span> <span className="text-muted-foreground">{s.text}</span>
            </p>
          ))}
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            {choice.leftover.length
              ? `I only need: ${choice.leftover.join("; ")}`
              : "That covers the question. Nothing more is needed."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {choice.leftover.length > 0 && (agent.status === "idle" || agent.status === "ended") && (
              <>
                <Button size="sm" onClick={() => void agent.start("text")}>
                  <KeyboardIcon /> Answer in chat
                </Button>
                <Button size="sm" variant="outline" onClick={() => void agent.start("voice")}>
                  <MicIcon /> Talk
                </Button>
              </>
            )}
            {choice.leftover.length === 0 && embedded && (
              <Button size="sm" disabled={writing} onClick={fillPage}>
                {writing ? <Loader2Icon className="animate-spin" /> : <PenLineIcon />} Fill the page
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
