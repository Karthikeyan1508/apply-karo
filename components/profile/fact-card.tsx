"use client"

import {
  CheckIcon,
  PencilIcon,
  QuoteIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { ProfileItem } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Where a fact came from, in words a person reads. */
export function sourceLabel(source?: string): string {
  if (!source) return "Saved"
  if (source === "interview") return "Your answer"
  if (source === "you") return "You"
  return source
}

/** One saved fact with its question, its value, the words it came from, and the controls for it. */
export function FactCard({
  fact,
  mode,
  onChange,
  onRemove,
}: {
  fact: ProfileItem
  /** "review": the onboarding review, edit in place. "profile": the saved profile, edit on request. */
  mode: "review" | "profile"
  onChange: (patch: Partial<ProfileItem>) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(fact.value)
  const editable = mode === "review" || editing
  const sensitive = Boolean(fact.sensitive)

  function save() {
    const value = draft.trim()
    if (!value) return
    onChange({ value, confirmed: true })
    setEditing(false)
  }

  return (
    <article className="panel flex flex-col gap-3 rounded-xl p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="min-w-0 flex-1 text-[13px] leading-snug font-semibold">
          {fact.label}
        </h3>
        <span className="border px-1.5 py-0.5 label-caps text-muted-foreground">
          {sourceLabel(fact.source)}
        </span>
        {fact.kind === "decision" && (
          <span className="border px-1.5 py-0.5 label-caps text-muted-foreground">
            {fact.category ?? "Decision"}
          </span>
        )}
        {sensitive && (
          <span className="border border-brand px-1.5 py-0.5 label-caps text-brand">
            Sensitive
          </span>
        )}
        {!fact.confirmed && (
          <span className="label-caps text-muted-foreground">To confirm</span>
        )}
      </div>

      {editable ? (
        <div className="flex flex-col gap-2">
          <Input
            value={mode === "review" ? fact.value : draft}
            onChange={(e) =>
              mode === "review"
                ? onChange({ value: e.target.value })
                : setDraft(e.target.value)
            }
            aria-label={`Value for ${fact.label}`}
            maxLength={2000}
            className="h-10 px-3 text-[15px] font-medium"
          />
          {mode === "profile" && (
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
              >
                <XIcon /> Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={!draft.trim()}>
                <CheckIcon /> Save
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[15px] leading-snug font-medium break-words">
          {fact.value}
        </p>
      )}

      {fact.quote && (
        <p className="flex items-start gap-2 border-l-2 border-brand/60 pl-3 text-xs leading-relaxed text-muted-foreground">
          <QuoteIcon className="mt-0.5 size-3 shrink-0 text-brand" />
          <span className="min-w-0 break-words">{fact.quote}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-3">
        {mode === "review" ? (
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2.5 text-xs font-medium"
            )}
          >
            <Switch
              checked={sensitive}
              onCheckedChange={(on) =>
                onChange({
                  sensitive: on,
                  autofill: on ? fact.autofill : false,
                })
              }
              aria-label={`Sensitive: ask before using ${fact.label}`}
              className="rounded-[3px] **:data-[slot=switch-thumb]:rounded-[2px]"
            />
            Ask before using it
          </label>
        ) : sensitive ? (
          <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium">
            <Switch
              checked={Boolean(fact.autofill)}
              onCheckedChange={(on) => onChange({ autofill: on })}
              aria-label={`OK to autofill ${fact.label}`}
              className="rounded-[3px] **:data-[slot=switch-thumb]:rounded-[2px]"
            />
            OK to autofill
          </label>
        ) : (
          <span className="text-xs text-muted-foreground">
            {fact.confirmed
              ? "Fills matching forms"
              : "Asked before it fills a form"}
          </span>
        )}

        <div className="flex items-center gap-1">
          {mode === "profile" && !editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(fact.value)
                setEditing(true)
              }}
              aria-label={`Edit ${fact.label}`}
            >
              <PencilIcon /> Edit
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove ${fact.label}`}
          >
            <Trash2Icon /> Remove
          </Button>
        </div>
      </div>
    </article>
  )
}
