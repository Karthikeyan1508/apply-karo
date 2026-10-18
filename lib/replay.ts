import { parseReplay } from "./demo.ts"

let cached: ReturnType<typeof parseReplay> | undefined

/** The `?replay` flag of this page load (read once), or null. Browser only: the server always gets null. */
export function replayMode() {
  if (typeof window === "undefined") return null
  if (cached === undefined) cached = parseReplay(window.location.search)
  return cached
}
