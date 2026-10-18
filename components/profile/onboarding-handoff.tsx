"use client"

import { Button } from "@/components/ui/button"
import { PanelHeader } from "@/components/workspace/panel-header"
import { useAgent } from "@/hooks/use-agent"
import { useInterviewStore } from "@/hooks/use-interview"
import { useProfileItems } from "@/hooks/use-profile-items"
import { findGaps, onboardingSession } from "@/lib/profile-gaps"
import { cn } from "@/lib/utils"
import { useView } from "./view"

/** After the onboarding questions are approved: the answers are saved to the profile, and this says so. */
export function OnboardingHandoff({ className }: { className?: string }) {
  const store = useInterviewStore()
  const agent = useAgent()
  const view = useView()
  const facts = useProfileItems()
  const session = store.getState().session
  const gaps = session?.onboardingPurpose === "grill" ? findGaps(facts) : []

  const finish = (next: "profile" | "home") => {
    agent.stop()
    store.dispatch({ type: "reset" })
    view.open(next)
  }

  const continueBasics = () => {
    if (!gaps.length) return finish("profile")
    agent.stop()
    store.dispatch({ type: "session", session: onboardingSession(gaps) })
  }

  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      <PanelHeader index="02" title="Saved" />
      <div className="flex flex-col gap-5 p-6">
        <h2 className="text-5xl display uppercase">
          Profile <span className="text-brand">updated.</span>
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Your answers are saved to your profile on this device, with the words
          behind each one. Matching forms now start filled in, and you only get
          asked what is still missing.
        </p>
        {session?.onboardingPurpose === "grill" && gaps.length > 0 && (
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Want to add the remaining basics, like contact details and
            preferences? You can skip any of them.
          </p>
        )}
        <p className="mono-caps tabular-nums">
          {facts.length} saved in your profile
        </p>
        <div className="flex flex-wrap gap-2">
          {session?.onboardingPurpose === "grill" && gaps.length > 0 && (
            <Button
              className="h-11 px-5 font-semibold"
              onClick={continueBasics}
            >
              Add profile basics
            </Button>
          )}
          <Button
            variant={
              session?.onboardingPurpose === "grill" && gaps.length > 0
                ? "outline"
                : "default"
            }
            className="h-11 px-5 font-semibold"
            onClick={() => finish("profile")}
          >
            Open my profile
          </Button>
          <Button
            variant="outline"
            className="h-11 px-4"
            onClick={() => finish("home")}
          >
            Back to start
          </Button>
        </div>
      </div>
    </section>
  )
}
