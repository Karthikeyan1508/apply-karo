"use client"

import { GithubConnect } from "./github-connect"
import { DownloadIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useSyncEnabled } from "@/hooks/use-auth"
import { useProfileItems } from "@/hooks/use-profile-items"
import { factId, mergeNewest } from "@/lib/core"
import {
  afterLocalChange,
  forgetProfile,
  loadProfile,
  parseProfileJson,
  profileJson,
  shown,
  writeProfile,
} from "@/lib/profile"
import { SECTIONS, sectionOf } from "@/lib/profile-keys"
import type { ProfileItem } from "@/lib/types"
import { FactCard } from "./fact-card"
import { ProfileFrame } from "./onboarding"
import { useView } from "./view"

/** Write the facts here, and to the account when this device syncs. Returns nothing: the page says what happened. */
async function persist(
  next: ProfileItem[],
  removed: boolean
): Promise<boolean> {
  if (!writeProfile(next)) {
    toast.error("Couldn't save", {
      description: "This browser is blocking storage.",
    })
    return false
  }
  const synced = await afterLocalChange(removed)
  if (synced === false)
    toast.warning(
      "Saved on this device. Couldn't reach your account, so it will sync later."
    )
  return true
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" })
  )
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** The saved profile: every fact grouped by section, with the words it came from, and what to do with each. */
export function ProfileScreen() {
  const view = useView()
  const all = useProfileItems()
  // What the resume gave is kept for filling forms but not listed or edited here.
  const facts = shown(all)
  const syncing = useSyncEnabled()
  const fileInput = useRef<HTMLInputElement>(null)
  const [confirmAll, setConfirmAll] = useState(false)

  const update = (fact: ProfileItem, patch: Partial<ProfileItem>) => {
    const id = factId(fact)
    void persist(
      all.map((f) => (factId(f) === id ? { ...f, ...patch } : f)),
      false
    )
  }

  const remove = (fact: ProfileItem) => {
    const id = factId(fact)
    void persist(
      all.filter((f) => factId(f) !== id),
      true
    ).then((ok) => ok && toast.success(`Removed ${fact.label}`))
  }

  const groups = SECTIONS.map((s) => ({
    s,
    items: facts.filter((f) => sectionOf(f) === s),
  })).filter((g) => g.items.length)

  return (
    <ProfileFrame onBack={() => view.open("home")}>
      <div className="flex flex-col gap-3">
        <p className="label-caps text-muted-foreground">Your profile</p>
        <h1 className="text-5xl display uppercase sm:text-6xl">
          {facts.length}{" "}
          <span className="text-brand">
            {facts.length === 1 ? "fact" : "facts"}.
          </span>
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          {syncing
            ? "Kept on this device and synced to your account."
            : "Kept in this browser only. Forms fill from these facts; you still approve every answer."}{" "}
          Sensitive facts are never filled in unless you switch on{" "}
          <strong className="font-semibold text-foreground">
            OK to autofill
          </strong>
          .
        </p>
      </div>

      <GithubConnect />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => view.open("onboarding", "sources")}
        >
          <PlusIcon /> Add another source
        </Button>
        <Button
          variant="outline"
          disabled={!facts.length}
          onClick={() => download("bolbharo-profile.json", profileJson(all))}
        >
          <DownloadIcon /> Export JSON
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Import a profile file"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (!file) return
            try {
              const imported = parseProfileJson(await file.text())
              const merged = mergeNewest(loadProfile(), imported)
              if (await persist(merged, false))
                toast.success(
                  `Imported ${imported.length} ${imported.length === 1 ? "fact" : "facts"}`
                )
            } catch (err) {
              toast.error("Couldn't import that file", {
                description: err instanceof Error ? err.message : undefined,
              })
            }
          }}
        />
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          <UploadIcon /> Import JSON
        </Button>
        {facts.length > 0 &&
          (confirmAll ? (
            <Button
              variant="destructive"
              onClick={async () => {
                await forgetProfile()
                setConfirmAll(false)
                toast.success("Profile deleted")
              }}
            >
              <Trash2Icon /> Yes, delete all {facts.length}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmAll(true)}>
              <Trash2Icon /> Delete all
            </Button>
          ))}
      </div>

      <p className="surface-lime rounded-xl p-4 text-xs leading-relaxed">
        The side panel keeps its own copy of the profile. To use yours there,
        export it here, then import it in the side panel. An export holds your
        facts and the words they came from, so keep the file private.
      </p>

      {facts.length === 0 ? (
        <div className="panel flex flex-col items-start gap-4 rounded-xl p-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            No facts yet. Add your resume, GitHub or LinkedIn and Apply करो will
            read them with you.
          </p>
          <Button onClick={() => view.open("onboarding", "welcome")}>
            Set up my profile
          </Button>
        </div>
      ) : (
        groups.map(({ s, items }) => (
          <section
            key={s}
            className="flex flex-col gap-3"
            aria-labelledby={`profile-${s}`}
          >
            <h2
              id={`profile-${s}`}
              className="flex items-center gap-2 label-caps text-muted-foreground"
            >
              {s} <span className="mono-caps tabular-nums">{items.length}</span>
            </h2>
            {items.map((f) => (
              <FactCard
                key={factId(f)}
                fact={f}
                mode="profile"
                onChange={(patch) => update(f, patch)}
                onRemove={() => remove(f)}
              />
            ))}
          </section>
        ))
      )}
    </ProfileFrame>
  )
}
