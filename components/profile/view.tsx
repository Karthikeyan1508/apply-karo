"use client"

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

/** Home is the interview start (landing, or the side panel's start screen). Profile and onboarding are the two profile screens. */
export type View = "home" | "onboarding" | "profile" | "dashboard"
/** Where onboarding opens: the welcome, or straight at the sources when adding another one. */
export type OnboardingStart = "welcome" | "sources"

interface ViewApi {
  view: View
  start: OnboardingStart
  open: (view: View, start?: OnboardingStart) => void
}

const Ctx = createContext<ViewApi | null>(null)

/** Which screen the app shows. Kept in memory: a reload returns to the start, as the interview does for a new form. */
export function ViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>("home")
  const [start, setStart] = useState<OnboardingStart>("welcome")
  const api = useMemo<ViewApi>(
    () => ({
      view,
      start,
      open: (next, from = "welcome") => {
        setStart(from)
        setView(next)
      },
    }),
    [view, start]
  )
  return <Ctx value={api}>{children}</Ctx>
}

export function useView(): ViewApi {
  const api = useContext(Ctx)
  if (!api) throw new Error("useView must be used inside ViewProvider")
  return api
}
