"use client"

import { useMemo, useSyncExternalStore } from "react"
import { parseSaved, readRaw, SESSION_EVENT, type Saved } from "@/lib/persist"

function subscribe(onChange: () => void) {
  window.addEventListener(SESSION_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(SESSION_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

/** The interview saved in this browser, or null. Null on the server and when storage is unavailable. */
export function useSavedSession(): Saved | null {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null)
  return useMemo(() => parseSaved(raw), [raw])
}
