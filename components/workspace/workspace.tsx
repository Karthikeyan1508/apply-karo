"use client"

import { ArrowLeftIcon, ListChecksIcon, MessagesSquareIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react"
import { useState } from "react"
import { Logo } from "@/components/brand/logo"
import { AccountMenu } from "@/components/account-menu"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { useView } from "@/components/profile/view"
import { useAgent } from "@/hooks/use-agent"
import { useDrafts } from "@/hooks/use-drafts"
import { useHealth } from "@/hooks/use-health"
import { useInterview, useInterviewStore } from "@/hooks/use-interview"
import { coverage } from "@/lib/core"
import { replayMode } from "@/lib/replay"
import { cn } from "@/lib/utils"
import { Captions } from "./captions"
import { FactsPanel } from "./facts-panel"
import { HandoffPanel } from "./handoff-panel"
import { PlanPanel } from "./plan-panel"
import { ReviewPanel } from "./review-panel"
import { TalkPanel } from "./talk-panel"

type Tab = "plan" | "talk" | "facts"

const TABS: { id: Tab; label: string; icon: typeof ListChecksIcon }[] = [
  { id: "plan", label: "Plan", icon: ListChecksIcon },
  { id: "talk", label: "Talk", icon: MessagesSquareIcon },
  { id: "facts", label: "Evidence", icon: ShieldCheckIcon },
]

const CHANNEL_LABEL = { voice: "Voice", text: "Text", demo: "Demo replay" } as const

function Panel({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return <div className={cn("panel min-h-0 overflow-hidden rounded-xl", visible ? "flex" : "hidden", "lg:flex")}>{children}</div>
}

export function Workspace() {
  const health = useHealth()
  const agent = useAgent()
  const store = useInterviewStore()
  const { session, channel, phase, guardLog } = useInterview()
  const [tab, setTab] = useState<Tab>("talk")
  const view = useView()
  useDrafts()
  const replay = replayMode()

  const cov = coverage(session)
  const blocked = guardLog.filter((g) => !g.accepted).length

  const newForm = () => {
    agent.stop()
    store.dispatch({ type: "reset" })
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="glass flex h-14 shrink-0 items-center gap-4 rounded-none border-x-0 border-t-0 px-4 lg:px-5">
        <Logo className="shrink-0 [&>div]:hidden sm:[&>div]:block" />
        <div className="min-w-0 flex-1 border-l pl-4">
          <p className="truncate text-sm font-semibold">{session?.title}</p>
        </div>
        <span className="mono-caps hidden text-muted-foreground tabular-nums md:inline">
          {cov.filled}/{cov.total} facts · {blocked} blocked
        </span>
        {channel && phase === "interview" && (
          <span className="label-caps hidden border px-2.5 py-1 text-muted-foreground sm:inline">
            {replay ? "Recorded replay" : CHANNEL_LABEL[channel]}
          </span>
        )}
        <AccountMenu />
        <ThemeToggle />
        <Button variant="outline" className="h-9 px-3" onClick={() => view.open("profile")}>
          <UserRoundIcon /> Profile
        </Button>
        <Button variant="outline" className="h-9 px-3" onClick={newForm}>
          <ArrowLeftIcon /> New form
        </Button>
      </header>

      {replay && <Captions />}

      <main
        id="main"
        className={cn(
          "grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)_minmax(320px,380px)] lg:p-4",
          // Leave room under the panels for the replay captions.
          replay && "pb-24 lg:pb-28"
        )}
      >
        <Panel visible={tab === "plan"}>
          <PlanPanel className="w-full" />
        </Panel>
        <Panel visible={tab === "talk"}>
          {phase === "approved" ? (
            <HandoffPanel className="w-full" />
          ) : phase === "complete" ? (
            <ReviewPanel className="w-full" />
          ) : (
            <TalkPanel health={health} className="w-full" />
          )}
        </Panel>
        <Panel visible={tab === "facts"}>
          <FactsPanel className="w-full" />
        </Panel>
      </main>

      <nav className="glass grid shrink-0 grid-cols-3 rounded-none border-x-0 border-b-0 lg:hidden" aria-label="Sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={cn(
              "label-caps flex items-center justify-center gap-2 py-3.5 transition-colors",
              tab === id ? "bg-brand text-brand-foreground" : "text-muted-foreground"
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
