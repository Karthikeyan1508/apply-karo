"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  createInterviewStore,
  type InterviewState,
  type InterviewStore,
} from "@/lib/interview-store"
import { writeSaved } from "@/lib/persist"
import { replayMode } from "@/lib/replay"

const StoreContext = createContext<InterviewStore | null>(null)

export function InterviewProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createInterviewStore())

  // Keep the interview in this browser so a refresh does not lose it. Nothing is written until the
  // store changes, so opening the page never wipes a saved interview that is waiting to be resumed.
  useEffect(() => {
    if (replayMode()) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let dirty = false
    const flush = () => {
      clearTimeout(timer)
      if (dirty) writeSaved(store.getState())
      dirty = false
    }
    const unsubscribe = store.subscribe(() => {
      dirty = true
      clearTimeout(timer)
      timer = setTimeout(flush, 500)
    })
    window.addEventListener("pagehide", flush)
    return () => {
      unsubscribe()
      window.removeEventListener("pagehide", flush)
      clearTimeout(timer)
    }
  }, [store])

  return <StoreContext value={store}>{children}</StoreContext>
}

export function useInterviewStore(): InterviewStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error("useInterviewStore must be used inside InterviewProvider")
  return store
}

export function useInterview(): InterviewState {
  const store = useInterviewStore()
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
