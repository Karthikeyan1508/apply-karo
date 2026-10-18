import { quoteSupported } from "./core"
import { canonicalKey, canonicalLabel, isSensitive } from "./profile-keys"
import type { ProfileItem } from "./types"

/** One of the person's own documents, labelled so every fact can say where it came from. */
export interface SourceText {
  /** "resume.pdf", "github", "linkedin" or "your resume". */
  name: string
  text: string
}

export interface RawFact {
  key: string
  label: string
  value: string
  quote: string
  source: string
}

/** Long documents are read in pieces this size. Each call stays well inside the model's token limit. */
export const CHUNK_CHARS = 12_000
const OVERLAP = 300
/** A cap on model calls per onboarding, to protect the daily budget. */
export const MAX_CHUNKS = 5

/** Split text into overlapping pieces, so a fact that straddles a boundary is still whole in one piece. */
export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  if (text.length <= size) return [text]
  const out: string[] = []
  for (let start = 0; ; start += size - OVERLAP) {
    out.push(text.slice(start, start + size))
    if (start + size >= text.length) return out
  }
}

const clean = (s: string, max: number) =>
  typeof s === "string" ? s.trim().slice(0, max) : ""

/**
 * The hard rule of onboarding. A fact survives only if its quote really appears in one of the source
 * texts, checked here in code, never taken from the model. Also keeps one fact per key, gives each a
 * unique label, and marks sensitive ones so they are not filled in without the person's say-so.
 */
export function groundFacts(
  raw: readonly RawFact[],
  sources: readonly SourceText[],
  now = Date.now()
): ProfileItem[] {
  const keys = new Set<string>()
  const labels = new Set<string>()
  const out: ProfileItem[] = []
  for (const r of raw) {
    const value = clean(r.value, 500)
    const quote = clean(r.quote, 300)
    if (!value || quote.length < 2) continue
    const src =
      sources.find(
        (s) => s.name === r.source && quoteSupported(quote, [s.text])
      ) ?? sources.find((s) => quoteSupported(quote, [s.text]))
    if (!src) continue
    const key = canonicalKey(r.key, r.label)
    if (keys.has(key)) continue
    keys.add(key)
    let label = canonicalLabel(key, clean(r.label, 120) || key)
    for (let n = 2; labels.has(label); n++)
      label = `${canonicalLabel(key, clean(r.label, 120) || key)} (${n})`
    labels.add(label)
    out.push({
      label,
      slot: "answer",
      value,
      quote,
      form: "Your profile",
      savedAt: now,
      key,
      source: src.name,
      confirmed: false,
      sensitive: isSensitive(key, label),
    })
  }
  return out
}
