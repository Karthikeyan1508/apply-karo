"use client"

import { useMemo, useSyncExternalStore } from "react"
import { parseStoredProfile, PROFILE_EVENT, readStoredProfile } from "@/lib/profile"
import type { ProfileItem } from "@/lib/types"

function subscribe(onChange: () => void) {
  window.addEventListener(PROFILE_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(PROFILE_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

/** Every saved fact on this device, re-read when they change. Empty on the server. */
export function useProfileItems(): ProfileItem[] {
  const raw = useSyncExternalStore(subscribe, readStoredProfile, () => null)
  return useMemo(() => parseStoredProfile(raw), [raw])
}
