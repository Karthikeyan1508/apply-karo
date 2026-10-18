import { answerStrength } from "@/lib/core"
import type { FormField } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Is this long answer yours, specific, and proven? Filled squares are met. It shows what probing is
 * still for: while talking, a square lights up as the agent gets a number or an outcome out of you.
 */
export function StrengthMeter({ field, className }: { field: FormField; className?: string }) {
  const s = answerStrength(field)
  if (!s) return null
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}
      role="img"
      aria-label={`Answer strength ${s.score} of ${s.checks.length}: ${s.checks
        .map((c) => `${c.label} ${c.ok ? "met" : "missing"}`)
        .join(", ")}`}
    >
      <span className="label-caps text-muted-foreground">
        Strength <span className="mono-caps tabular-nums">{s.score}/{s.checks.length}</span>
      </span>
      {s.checks.map((c) => (
        <span
          key={c.key}
          className={cn("label-caps inline-flex items-center gap-1.5 text-[10px]", c.ok ? "text-foreground" : "text-muted-foreground/70")}
        >
          <span className={cn("size-2 transition-colors duration-500", c.ok ? "bg-brand" : "border border-current")} />
          {c.label}
        </span>
      ))}
    </div>
  )
}
