"use client"

import { ArrowRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProfileCount } from "@/hooks/use-profile-count"
import { useView } from "./view"

/** The profile's entry point: "Set up your profile" the first time, "Profile ready: N facts" after. */
export function ProfileCard({ className }: { className?: string }) {
  const view = useView()
  const count = useProfileCount()
  const ready = count > 0
  return (
    <section className={`panel flex flex-col gap-4 rounded-xl p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${className ?? ""}`} aria-labelledby="profile-card-title">
      <div className="min-w-0">
        <p className="label-caps text-muted-foreground">Your profile</p>
        <h2 id="profile-card-title" className="display mt-2 text-3xl uppercase sm:text-4xl">
          {ready ? (
            <>
              Profile ready: <span className="text-brand tabular-nums">{count}</span> {count === 1 ? "fact" : "facts"}
            </>
          ) : (
            <>
              Set up your <span className="text-brand">profile.</span>
            </>
          )}
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {ready
            ? "Matching forms start filled in from it. You are only asked what is still missing."
            : "Add your resume, GitHub and LinkedIn once. Later forms then start filled in, and you only answer what is missing."}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {ready ? (
          <>
            <Button className="h-11 px-5 font-semibold" onClick={() => view.open("profile")}>
              Open profile <ArrowRightIcon />
            </Button>
            <Button variant="outline" className="h-11 px-4" onClick={() => view.open("onboarding", "sources")}>
              Add a source
            </Button>
          </>
        ) : (
          <Button className="h-11 px-5 font-semibold" onClick={() => view.open("onboarding", "welcome")}>
            Set it up <ArrowRightIcon />
          </Button>
        )}
      </div>
    </section>
  )
}
