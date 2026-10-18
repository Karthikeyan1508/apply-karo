"use client"

import { CheckIcon, HistoryIcon, MinusIcon, QuoteIcon } from "lucide-react"
import { useEffect, useRef } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { pop } from "@/lib/anim"
import type { Slot } from "@/lib/types"
import { cn } from "@/lib/utils"

/** "own_part" becomes "Own part". */
export function slotLabel(name: string) {
  const spaced = name.replace(/_/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

type ChipState = "open" | "filled" | "pending" | "skipped"

function stateOf(slot: Slot): ChipState {
  if (slot.value !== null) return slot.fromProfile ? "pending" : "filled"
  return slot.skipped ? "skipped" : "open"
}

/** One fact the agent still needs (dashed), has captured (solid lime), wants confirmed (outline) or dropped. */
export function SlotChip({ slot }: { slot: Slot }) {
  const ref = useRef<HTMLSpanElement>(null)
  const state = stateOf(slot)
  const previous = useRef(state)

  useEffect(() => {
    if (previous.current !== "filled" && state === "filled") pop(ref.current)
    previous.current = state
  }, [state])

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            ref={ref}
            data-state={state}
            className={cn(
              "label-caps inline-flex cursor-default items-center gap-1 rounded-lg border px-2 py-[3px] text-[10.5px] font-semibold transition-colors",
              state === "open" && "border-dashed text-muted-foreground",
              state === "filled" && "border-transparent bg-brand text-brand-foreground",
              state === "pending" && "border-brand/70 bg-brand/10 text-foreground",
              state === "skipped" && "border-transparent bg-muted text-muted-foreground line-through"
            )}
          />
        }
      >
        {state === "filled" && <CheckIcon className="size-3" strokeWidth={3} />}
        {state === "pending" && <HistoryIcon className="size-3" />}
        {state === "skipped" && <MinusIcon className="size-3" />}
        {slotLabel(slot.name)}
      </TooltipTrigger>
      <TooltipContent className="max-w-64 flex-col items-start gap-1">
        {state === "filled" || state === "pending" ? (
          <>
            <span className="font-semibold">{slot.value}</span>
            {slot.quote && (
              <span className="flex items-start gap-1 opacity-80">
                <QuoteIcon className="mt-0.5 size-3 shrink-0" />
                <span>{slot.quote}</span>
              </span>
            )}
            {state === "pending" && (
              <span className="opacity-80">From {slot.source ?? "an earlier form"}. Say yes to confirm.</span>
            )}
          </>
        ) : (
          <span>{state === "skipped" ? "Skipped" : slot.ask}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
