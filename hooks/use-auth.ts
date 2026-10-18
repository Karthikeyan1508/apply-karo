"use client"

import { useEffect, useSyncExternalStore } from "react"
import type { AuthInfo } from "@/lib/types"

const OFF: AuthInfo = { configured: false, sync: false, user: null }
let current: AuthInfo | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Ask the server who is signed in. Shared by every component, so the page asks once. */
export function refreshAuth(): Promise<void> {
  inflight ??= fetch("/api/account", { cache: "no-store" })
    .then((r) => r.json() as Promise<AuthInfo>)
    .then((info) => void (current = info))
    .catch(() => void (current ??= OFF))
    .finally(() => {
      inflight = null
      listeners.forEach((l) => l())
    })
  return inflight
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => void listeners.delete(onChange)
}

/** Who is signed in. null until the server has answered. */
export function useAuth(): AuthInfo | null {
  useEffect(() => {
    if (!current) void refreshAuth()
  }, [])
  return useSyncExternalStore(subscribe, () => current, () => null)
}

/** Saved facts and filled forms are kept in the account whenever this person is signed in and a database exists. */
export function useSyncing(): boolean {
  const auth = useAuth()
  return Boolean(auth?.user && auth.sync)
}
