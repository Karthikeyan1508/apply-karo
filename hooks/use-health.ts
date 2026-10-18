"use client"

import { useEffect, useState } from "react"
import type { Health } from "@/lib/types"

/** Which keys the server has. null while loading. */
export function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json() as Promise<Health>)
      .then((h) => alive && setHealth(h))
      .catch(
        () => alive && setHealth({ llm: false, voice: false, voicePrivate: false, auth: false, forms: false, sync: false, github: false })
      )
    return () => {
      alive = false
    }
  }, [])

  return health
}
