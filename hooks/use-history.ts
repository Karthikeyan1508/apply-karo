"use client"

import { useMemo, useSyncExternalStore } from "react"
import { parseHistory, type FormRecord } from "@/lib/history"
import { HISTORY_EVENT, readHistoryRaw } from "@/lib/history-client"

function subscribe(onChange: () => void) {
  window.addEventListener(HISTORY_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(HISTORY_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

/** Every form the person approved, newest first, re-read when they change. Empty on the server. */
export function useHistory(): FormRecord[] {
  const raw = useSyncExternalStore(subscribe, readHistoryRaw, () => null)
  return useMemo(() => parseHistory(raw), [raw])
}
