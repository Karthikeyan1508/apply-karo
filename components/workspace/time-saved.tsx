"use client"

import { useInterview } from "@/hooks/use-interview"
import { formatDuration, typingEstimateSecs } from "@/lib/core"
import { cn } from "@/lib/utils"

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="label-caps text-muted-foreground">{label}</p>
      <p className="display mt-2 text-5xl tabular-nums">{value}</p>
      {note && <p className="mono-caps mt-1.5 text-muted-foreground">{note}</p>}
    </div>
  )
}

/**
 * "Done in 3:12. Typing this would take about 14 min." The typing time is an estimate and says so.
 * A scripted replay has no honest speaking time, so it only shows the typing side.
 */
export function TimeSaved({ className }: { className?: string }) {
  const { session, startedAt, finishedAt, finishedVia } = useInterview()
  if (!session) return null

  const typing = typingEstimateSecs(session)
  if (!typing) return null
  const spoken = startedAt !== null && finishedAt !== null && finishedVia !== "demo" ? (finishedAt - startedAt) / 1000 : null
  const typingMin = Math.max(1, Math.round(typing / 60))
  const savedMin = spoken !== null ? Math.round((typing - spoken) / 60) : 0

  return (
    <div className={cn("block-lime grid gap-6 rounded-xl p-5 sm:grid-cols-3", className)}>
      {spoken !== null ? (
        <>
          <Stat label="Done in" value={formatDuration(spoken)} />
          <Stat label="Typing it by hand" value={`~${typingMin} min`} />
          <Stat label="Time saved" value={savedMin > 0 ? `~${savedMin} min` : "none"} />
        </>
      ) : (
        <>
          <Stat label="Typing these by hand" value={`~${typingMin} min`} />
          <p className="label-caps self-end text-muted-foreground sm:col-span-2">
            Scripted replay, so no speaking time is shown.
          </p>
        </>
      )}
      <p className="mono-caps text-muted-foreground sm:col-span-3">
        Typing estimate: 40 words a minute, plus 25 seconds of thinking per long answer.
      </p>
    </div>
  )
}
