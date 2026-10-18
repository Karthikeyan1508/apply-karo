"use client"

import { ChevronDownIcon, ExternalLinkIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { useHistory } from "@/hooks/use-history"
import { clearHistory, removeRecord } from "@/lib/history-client"
import type { FormRecord } from "@/lib/history"
import { ProfileFrame } from "@/components/profile/onboarding"
import { useView } from "@/components/profile/view"
import { cn } from "@/lib/utils"

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })

const host = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null
  } catch {
    return null
  }
}

function FormCard({ record, open, onToggle }: { record: FormRecord; open: boolean; onToggle: () => void }) {
  const site = host(record.url)
  return (
    <li className="panel rounded-xl">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-start gap-4 p-5 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{record.title}</p>
          <p className="mono-caps mt-1 text-muted-foreground tabular-nums">
            {when(record.filledAt)} · {record.answers.length} {record.answers.length === 1 ? "answer" : "answers"}
            {site ? ` · ${site}` : ""}
          </p>
        </div>
        <ChevronDownIcon className={cn("mt-1 size-5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t px-5 pb-5">
          <dl className="mt-4 flex flex-col gap-4">
            {record.answers.map((a, i) => (
              <div key={i}>
                <dt className="label-caps text-muted-foreground">{a.question}</dt>
                <dd className="mt-1 text-[15px] leading-relaxed whitespace-pre-wrap">{a.answer}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            {record.url && (
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={record.url} target="_blank" rel="noreferrer" />}>
                Open the form <ExternalLinkIcon />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await removeRecord(record.id)
                toast.success("Removed")
              }}
            >
              <Trash2Icon /> Remove
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Every form the person has approved, with the questions and the answers that went into it. */
export function Dashboard() {
  const view = useView()
  const records = useHistory()
  const auth = useAuth()
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const syncing = Boolean(auth?.user && auth.sync)

  return (
    <ProfileFrame onBack={() => view.open("home")}>
      <div className="flex flex-col gap-3">
        <p className="label-caps text-muted-foreground">Dashboard</p>
        <h1 className="text-5xl display uppercase sm:text-6xl">
          {records.length} <span className="text-brand">{records.length === 1 ? "form." : "forms."}</span>
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          {syncing
            ? "Every form you approve is kept here and in your account, with its questions and your answers."
            : "Every form you approve is kept here with its questions and your answers. Sign in and they are kept in your account too."}
        </p>
      </div>

      {records.length > 0 &&
        (confirmAll ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="destructive"
              onClick={async () => {
                await clearHistory()
                setConfirmAll(false)
                toast.success("All forms removed")
              }}
            >
              <Trash2Icon /> Yes, remove all {records.length}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmAll(false)}>
              Keep them
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="outline" onClick={() => setConfirmAll(true)}>
              <Trash2Icon /> Remove all
            </Button>
          </div>
        ))}

      {records.length === 0 ? (
        <p className="panel rounded-xl p-6 text-sm leading-relaxed text-muted-foreground">
          No forms yet. Approve one and it shows up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {records.map((r) => (
            <FormCard key={r.id} record={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />
          ))}
        </ul>
      )}
    </ProfileFrame>
  )
}
