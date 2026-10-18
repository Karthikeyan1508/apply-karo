"use client"

import { useEffect, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { Logo } from "@/components/brand/logo"
import { useAgent } from "@/hooks/use-agent"
import { useInterviewStore } from "@/hooks/use-interview"
import { autofillPayload, isExtensionOrigin, PageForm } from "@/lib/page-form"
import { prefillFromProfile } from "@/lib/profile"
import type { ApiError, Session } from "@/lib/types"
import { ProfileCard } from "@/components/profile/profile-card"
import { useView } from "@/components/profile/view"

/** True when this page is the browser extension's side panel: the app inside a frame. */
export function useEmbedded(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => window.parent !== window,
    () => false
  )
}

/** The extension that framed this page, or null. Messages to it name it, so nothing else can read them. */
export const extensionOrigin = () => {
  const origin = location.ancestorOrigins?.[0]
  return origin && isExtensionOrigin(origin) ? origin : null
}

/** Receives a form read off the open page by the extension and starts an interview on it. */
export function ExtensionBridge() {
  const store = useInterviewStore()
  const agent = useAgent()
  const view = useView()

  useEffect(() => {
    const parent = extensionOrigin()
    if (!parent) return

    async function onMessage(e: MessageEvent) {
      if (
        e.source !== window.parent ||
        e.origin !== parent ||
        e.data?.type !== "bolbharo:form"
      )
        return
      const page = PageForm.safeParse(e.data.form)
      if (!page.success) {
        toast.error("Couldn't read the questions on that page.")
        return
      }
      const id = toast.loading(`Reading ${page.data.fields.length} questions…`)
      try {
        const res = await fetch("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "page", page: page.data }),
        })
        const body = (await res.json()) as { session: Session } | ApiError
        if (!res.ok || "error" in body) {
          toast.error(
            "error" in body ? body.error.message : "Something went wrong.",
            { id }
          )
          return
        }
        // A call already running was briefed on the old form. End it so the next one starts on this one.
        agent.stop()
        const session = await prefillFromProfile(body.session, true)
        store.dispatch({ type: "session", session })
        // A form from the page always opens the interview, even from the profile screen.
        view.open("home")
        toast.dismiss(id)
        // Autofill: type what the profile knows into the page now. The interview still covers the rest.
        if (e.data.autofill) {
          const fields = autofillPayload(session)
          if (fields.length) window.parent.postMessage({ type: "bolbharo:fill", fields }, parent)
          else toast.message("Nothing in your profile matches this page yet. Answer the questions and they will be remembered.")
        }
      } catch {
        toast.error("Couldn't reach Apply करो. Is the server running?", { id })
      }
    }

    window.addEventListener("message", onMessage)
    window.parent.postMessage({ type: "bolbharo:ready" }, parent)
    return () => window.removeEventListener("message", onMessage)
    // The agent's controls change when a call starts; the listener only needs the stop at message time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, view])

  return null
}

/** The side panel's start screen: the page is the source, so there is nothing to pick. */
export function EmbedHome() {
  return (
    <main id="main" className="flex min-h-dvh flex-col gap-6 p-6">
      <Logo />
      <div className="panel rounded-xl p-6">
        <p className="label-caps text-muted-foreground">Step 1</p>
        <h1 className="mt-3 text-4xl display uppercase">
          Open a <span className="text-brand">form.</span>
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Go to any page with a form: a job application, a loan form, a survey.
          Then press <strong className="text-foreground">Read this page</strong>{" "}
          above. Apply करो reads the questions, interviews you, and fills the
          page in once you approve. It never presses Submit.
        </p>
      </div>
      <ProfileCard />
    </main>
  )
}
