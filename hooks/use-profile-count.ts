"use client"

import { useSyncExternalStore } from "react"
import { loadProfile, PROFILE_EVENT, shown } from "@/lib/profile"

function subscribe(onChange: () => void) {
  window.addEventListener(PROFILE_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(PROFILE_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

/** How many facts are saved on this device. 0 on the server and while storage is unavailable. */
export function useProfileCount(): number {
  return useSyncExternalStore(subscribe, () => shown(loadProfile()).length, () => 0)
}
