import { keyOf } from "./profile-keys"
import type {
  FormField,
  ProfileItem,
  Rejection,
  Session,
  SlotUpdate,
} from "./types"

export const MIN_QUOTE_CHARS = 2

/** Lowercase, strip punctuation, collapse spaces. Keeps letters, marks (Devanagari matras) and digits. */
export function norm(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** The anti-hallucination guard: a quote counts only if the user actually said it. */
export function quoteSupported(
  quote: string,
  said: readonly string[]
): boolean {
  const q = norm(quote)
  if (q.length < MIN_QUOTE_CHARS) return false
  return norm(said.join(" ")).includes(q)
}

export interface ApplyResult {
  session: Session
  accepted: SlotUpdate[]
  rejected: Rejection[]
  changedFieldIds: string[]
}

/**
 * Apply slot updates from the agent. Pure: returns a new session.
 *
 * shortcut: the guard proves the quote was said, not that it supports the value.
 * Upgrade: an entailment check in the drafter. Until then the UI shows every value
 * next to its quote so a human catches mismatches.
 */
export function applyUpdates(
  session: Session,
  updates: readonly SlotUpdate[],
  said: readonly string[]
): ApplyResult {
  const fields = session.fields.map((f) => ({
    ...f,
    slots: f.slots.map((s) => ({ ...s })),
  }))
  const byId = new Map(fields.map((f) => [f.id, f]))
  const accepted: SlotUpdate[] = []
  const rejected: Rejection[] = []
  const changed = new Set<string>()

  for (const u of updates) {
    const field = byId.get(u.field)
    const slot = field?.slots.find((s) => s.name === u.slot)
    if (!field || !slot) {
      rejected.push({ update: u, reason: `unknown slot ${u.field}.${u.slot}` })
      continue
    }
    if (u.skip) {
      if (slot.value === null) {
        slot.skipped = true
        accepted.push(u)
        changed.add(field.id)
      } else {
        rejected.push({ update: u, reason: "slot already filled" })
      }
      continue
    }
    const value = (u.value ?? "").trim()
    const quote = (u.quote ?? "").trim()
    if (!value) {
      rejected.push({ update: u, reason: "empty value" })
      continue
    }
    if (!quote) {
      rejected.push({ update: u, reason: "missing quote" })
      continue
    }
    if (!quoteSupported(quote, said)) {
      rejected.push({
        update: u,
        reason: "quote not found in what the user said",
      })
      continue
    }
    // The user confirmed an answer from an earlier form: keep the original quote as evidence.
    const confirms =
      slot.fromProfile &&
      slot.value !== null &&
      norm(value) === norm(slot.value)
    if (!confirms) {
      slot.value = value
      slot.quote = quote
      slot.source = undefined
    }
    slot.skipped = false
    slot.fromProfile = false
    accepted.push(u)
    changed.add(field.id)
  }

  return {
    session: { ...session, fields },
    accepted,
    rejected,
    changedFieldIds: [...changed],
  }
}

export interface OpenSlot {
  fieldId: string
  fieldLabel: string
  slot: string
  ask: string
}

export function openSlots(session: Session): OpenSlot[] {
  return session.fields.flatMap((f) =>
    f.slots
      .filter((s) => s.value === null && !s.skipped)
      .map((s) => ({
        fieldId: f.id,
        fieldLabel: f.label,
        slot: s.name,
        ask: s.ask,
      }))
  )
}

export interface Coverage {
  total: number
  /** Confirmed by the user in this session. */
  filled: number
  /** Pre-filled from an earlier form, waiting for a confirmation. */
  pending: number
  skipped: number
  open: number
  /** 0-100, counts skipped slots as handled. */
  pct: number
}

export function coverage(session: Session | null): Coverage {
  const slots = session?.fields.flatMap((f) => f.slots) ?? []
  const filled = slots.filter((s) => s.value !== null && !s.fromProfile).length
  const pending = slots.filter((s) => s.value !== null && s.fromProfile).length
  const skipped = slots.filter((s) => s.value === null && s.skipped).length
  const total = slots.length
  return {
    total,
    filled,
    pending,
    skipped,
    open: total - filled - pending - skipped,
    pct: total === 0 ? 0 : Math.round(((filled + skipped) / total) * 100),
  }
}

export type FieldStatus = "empty" | "partial" | "complete"

export function fieldStatus(f: FormField): FieldStatus {
  const handled = f.slots.filter(
    (s) => (s.value !== null && !s.fromProfile) || s.skipped
  ).length
  if (handled === 0) return "empty"
  return handled === f.slots.length ? "complete" : "partial"
}

/** Compact plan for the agent's `plan` dynamic variable: one line per field. */
export function planText(session: Session): string {
  return session.fields
    .map((f) => {
      const slots = f.slots
        .map((s) => {
          const mark =
            s.value === null
              ? ""
              : s.fromProfile
                ? ` (from an earlier form: "${s.value}". Confirm it.)`
                : " (already filled)"
          return `${s.name}="${s.ask}"${mark}`
        })
        .join("; ")
      return `${f.id} | ${f.label} | wants: ${f.intent || "a clear answer"} | slots: ${slots}`
    })
    .join("\n")
}

/** What `finish_interview` returns while something is open or waiting for a confirmation. */
export function openSlotsText(session: Session): string {
  const open = openSlots(session).map(
    (o) => `${o.fieldId}.${o.slot} (${o.ask})`
  )
  const confirm = session.fields.flatMap((f) =>
    f.slots
      .filter((s) => s.fromProfile && s.value !== null)
      .map((s) => `${f.id}.${s.name} (confirm "${s.value}")`)
  )
  return [...open, ...confirm].join("; ")
}

export function firstQuestion(session: Session): string {
  const open = openSlots(session)[0]
  if (open) return open.ask
  if (coverage(session).pending > 0) {
    return "I already have some answers from last time. Can I check them with you?"
  }
  return "What would you like to start with?"
}

/** Numbers in a draft that appear nowhere in the user's extracted facts. */
export function unsupportedNumbers(draft: string, facts: string): string[] {
  const seen = facts.replace(/[,\s]/g, "")
  const out: string[] = []
  for (const raw of draft.match(/\d[\d,.]*/g) ?? []) {
    const n = raw.replace(/[.,]+$/, "")
    if (!seen.includes(n.replace(/,/g, ""))) out.push(n)
  }
  return out
}

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`
}

// ---------- Phase 2: drafts ----------

/** Facts the user has confirmed in this session (not pending profile pre-fills). */
export function confirmedFacts(f: Pick<FormField, "slots">) {
  return f.slots
    .filter((s) => s.value !== null && !s.fromProfile)
    .map((s) => ({
      slot: s.name,
      value: s.value as string,
      quote: s.quote,
      source: s.source,
    }))
}

/** Changes whenever the facts behind a draft change. */
export function factSignature(f: Pick<FormField, "slots">): string {
  return confirmedFacts(f)
    .map((x) => `${x.slot}=${x.value}`)
    .join("|")
}

export function needsDraft(f: FormField): boolean {
  const sig = factSignature(f)
  return sig !== "" && sig !== f.draftSig && !f.edited
}

/** A plain draft with no language model: the user's own fact wording, joined up. */
export function draftFromValues(
  f: Pick<FormField, "kind" | "options">,
  values: string[]
): string {
  if (f.kind === "choice" && f.options.length) {
    const hit = f.options.find((o) =>
      values.some((v) => norm(v).includes(norm(o)) || norm(o).includes(norm(v)))
    )
    return hit ?? values[0] ?? ""
  }
  if (values.length <= 1) return values[0] ?? ""
  return values.map((v) => (/[.!?]$/.test(v) ? v : `${v}.`)).join(" ")
}

export function draftFallback(f: FormField): string {
  return draftFromValues(
    f,
    confirmedFacts(f).map((x) => x.value)
  )
}

/** Review warnings for a draft: numbers the user never said, and length. */
export function draftFlags(
  f: Pick<FormField, "slots" | "maxChars">,
  text: string,
  extraFacts = ""
): string[] {
  const flags: string[] = []
  const facts = `${confirmedFacts(f)
    .map((x) => x.value)
    .join(" ")} ${extraFacts}`
  for (const n of unsupportedNumbers(text, facts)) {
    flags.push(`Check "${n}": it isn't in what you told me`)
  }
  if (f.maxChars && text.length > f.maxChars) {
    flags.push(`${text.length - f.maxChars} characters over the limit`)
  }
  return flags
}

/** Required questions that still have no answer. */
export function missingRequired(session: Session): FormField[] {
  return session.fields.filter((f) => f.required && !f.draft.trim())
}

// ---------- Phase 2: handing the answers over ----------

/** A Google Form link with every answer pre-filled. The user checks it and presses Submit. */
export function buildPrefillUrl(session: Session): string | null {
  if (session.source !== "google" || !session.formUrl) return null
  let url: URL
  try {
    url = new URL(session.formUrl)
  } catch {
    return null
  }
  if (url.hostname !== "docs.google.com") return null
  url.pathname = `${url.pathname.replace(/\/(viewform|formResponse)\/?$/, "").replace(/\/$/, "")}/viewform`
  url.search = ""
  url.hash = ""
  url.searchParams.set("usp", "pp_url")
  for (const f of session.fields) {
    if (!f.entryId || !f.draft.trim()) continue
    const picked =
      f.kind === "choice" ? f.options.filter((o) => f.draft.includes(o)) : []
    for (const v of picked.length ? picked : [f.draft]) {
      url.searchParams.append(`entry.${f.entryId}`, v)
    }
  }
  return url.toString()
}

export function exportText(session: Session): string {
  return session.fields
    .filter((f) => f.draft.trim())
    .map((f) => `${f.label}\n${f.draft.trim()}`)
    .join("\n\n")
}

export function exportJson(session: Session, at = new Date()): string {
  return JSON.stringify(
    {
      form: session.title,
      approvedAt: at.toISOString(),
      answers: session.fields.map((f) => ({
        question: f.label,
        answer: f.draft,
        facts: confirmedFacts(f),
      })),
    },
    null,
    2
  )
}

// ---------- Phase 2: saved profile ----------

export interface PrefillFill {
  fieldId: string
  slot: string
  item: ProfileItem
}

const profileKey = (label: string, slot: string) => `${norm(label)}|${slot}`

/** The identity of a saved fact: its question and slot. Unique in a profile. */
export const factId = (
  p: Pick<ProfileItem, "label" | "slot" | "key" | "kind">
) =>
  p.kind === "decision" && p.key
    ? `decision:${p.key}`
    : profileKey(p.label, p.slot)

/** Confirmed, quoted facts from this session, ready to save. */
export function profileFromSession(
  session: Session,
  now = Date.now()
): ProfileItem[] {
  return session.fields.flatMap((f) =>
    f.slots
      .filter((s) => s.value !== null && !s.fromProfile && s.quote)
      .map((s) => ({
        label: f.label,
        slot: s.name,
        value: s.value as string,
        quote: s.quote as string,
        form: session.title,
        savedAt: now,
      }))
  )
}

/** Newer facts replace older ones for the same question and slot. */
export function mergeProfile(
  existing: ProfileItem[],
  incoming: ProfileItem[]
): ProfileItem[] {
  const map = new Map(existing.map((p) => [factId(p), p]))
  for (const p of incoming) map.set(factId(p), p)
  return [...map.values()]
}

/**
 * Union of two lists of saved facts, newest `savedAt` per question and slot. Order does not matter and
 * merging twice changes nothing, so two devices that sync in turn end up with the same facts.
 */
export function mergeNewest(
  a: readonly ProfileItem[],
  b: readonly ProfileItem[]
): ProfileItem[] {
  const map = new Map<string, ProfileItem>()
  for (const p of [...a, ...b]) {
    const key = factId(p)
    const have = map.get(key)
    if (!have || p.savedAt >= have.savedAt) map.set(key, p)
  }
  return [...map.values()]
}

/**
 * Free matching: the same question wording and slot. A single-answer question also matches a saved
 * fact with the same canonical key (for example "Your email" and the `email` fact).
 */
export function matchExact(
  session: Session,
  saved: readonly ProfileItem[]
): PrefillFill[] {
  const fillable = saved.filter((p) => p.kind !== "decision")
  const byKey = new Map(fillable.map((p) => [factId(p), p]))
  const byCanon = new Map(
    fillable.flatMap((p) => (p.key ? [[p.key, p] as const] : []))
  )
  return session.fields.flatMap((f) =>
    f.slots.flatMap((s) => {
      if (s.value !== null || s.skipped) return []
      const canon = f.slots.length === 1 ? keyOf(f.label) : null
      const item =
        byKey.get(profileKey(f.label, s.name)) ??
        (canon ? byCanon.get(canon) : undefined)
      return item ? [{ fieldId: f.id, slot: s.name, item }] : []
    })
  )
}

/**
 * A saved fact fills a slot as a finished answer when the person confirmed it and it is not sensitive,
 * or when they explicitly allowed it. Everything else is pending: the interview asks them to confirm.
 */
export const autoApplies = (p: ProfileItem) =>
  Boolean(p.autofill || (p.confirmed && !p.sensitive))

/** Fill still-empty slots with saved facts. Confirmed, non-sensitive facts count as answered; others wait for a confirmation. */
export function applyPrefill(
  session: Session,
  fills: readonly PrefillFill[]
): Session {
  const by = new Map(fills.map((x) => [`${x.fieldId}.${x.slot}`, x.item]))
  return {
    ...session,
    fields: session.fields.map((f) => ({
      ...f,
      slots: f.slots.map((s) => {
        const item = by.get(`${f.id}.${s.name}`)
        if (!item || s.value !== null || s.skipped) return s
        return autoApplies(item)
          ? {
              ...s,
              value: item.value,
              quote: item.quote,
              fromProfile: false,
              source: item.source ?? "profile",
            }
          : {
              ...s,
              value: item.value,
              quote: item.quote,
              fromProfile: true,
              source: item.source,
            }
      }),
    })),
  }
}

const isHindi = (session: Pick<Session, "lang">) => session.lang === "hi-IN"

/**
 * The language code to ask the ElevenLabs agent for at session start, or undefined to keep its default.
 * Needs the "hi" language preset and the client language override that `npm run configure:agent` sets.
 */
export function agentLanguage(
  session: Pick<Session, "lang">
): "hi" | undefined {
  return isHindi(session) ? "hi" : undefined
}

/** Values for the agent's dynamic variables ({{plan}}, {{first_question}} and so on). */
export function buildDynamicVariables(
  session: Session
): Record<string, string> {
  const hindi = isHindi(session)
  return {
    form_title: session.title,
    plan: planText(session),
    context: session.context.trim().slice(0, 4000) || "none",
    language: hindi
      ? "Hindi: Devanagari script, plain everyday Hindi, keeping common English words as people say them (form, app, project)"
      : "English",
    greeting: hindi
      ? `नमस्ते! ${session.title} भरने में मैं आपकी मदद के लिए हूँ। आपकी मंज़ूरी के बिना कुछ भी जमा नहीं होगा।`
      : `Hi! I'll help you fill in ${session.title}. Nothing gets submitted without your OK.`,
    first_question: firstQuestion(session),
  }
}

// ---------- Time saved ----------

const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0)

/** Rough time to type these answers by hand: 40 words a minute, plus 25 seconds of thinking per long answer. */
export function typingEstimateSecs(session: Session): number {
  let secs = 0
  for (const f of session.fields) {
    const text =
      f.draft.trim() ||
      confirmedFacts(f)
        .map((x) => x.value)
        .join(" ")
    const w = wordCount(text)
    if (w) secs += (w / 40) * 60 + (f.kind === "long_text" ? 25 : 5)
  }
  return Math.round(secs)
}

/** 192 seconds becomes "3:12". */
export function formatDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// ---------- Answer strength ----------

export interface Strength {
  checks: {
    key: "yours" | "number" | "outcome" | "detail"
    label: string
    ok: boolean
  }[]
  score: number
}

const SLOT_KIND = {
  yours: /own|role|action|contribution|part/,
  number: /number|amount|sales|users|years|count|revenue|orders|size|price/,
  outcome: /outcome|result|impact|achievement|changed/,
}

/**
 * Does a long answer have what the brief asks for: your own part, a number, an outcome, enough detail?
 * Only checks that the form's slots can actually satisfy, and needs at least two to show a meter.
 */
export function answerStrength(
  f: Pick<FormField, "kind" | "slots">
): Strength | null {
  if (f.kind !== "long_text") return null
  const confirmed = f.slots.filter((s) => s.value !== null && !s.fromProfile)
  const can = (re: RegExp) => f.slots.some((s) => re.test(s.name))
  const met = (re: RegExp, digit = false) =>
    confirmed.some(
      (s) => re.test(s.name) && (!digit || /\d/.test(s.value ?? ""))
    )
  const checks: Strength["checks"] = []
  if (can(SLOT_KIND.yours))
    checks.push({ key: "yours", label: "Yours", ok: met(SLOT_KIND.yours) })
  if (can(SLOT_KIND.number))
    checks.push({
      key: "number",
      label: "Number",
      ok: met(SLOT_KIND.number, true),
    })
  if (can(SLOT_KIND.outcome))
    checks.push({
      key: "outcome",
      label: "Outcome",
      ok: met(SLOT_KIND.outcome),
    })
  if (f.slots.length >= 3)
    checks.push({ key: "detail", label: "Detail", ok: confirmed.length >= 3 })
  return checks.length >= 2
    ? { checks, score: checks.filter((c) => c.ok).length }
    : null
}

// ---------- Facts from an uploaded document ----------

export interface DocFill {
  field: string
  slot: string
  value: string
  quote: string
}

/** Keep only fills for still-open slots whose quote really appears in the document. One per slot. */
export function validDocFills(
  fills: readonly DocFill[],
  docText: string,
  session: Session
): DocFill[] {
  const open = new Set(openSlots(session).map((o) => `${o.fieldId}.${o.slot}`))
  const seen = new Set<string>()
  return fills.filter((f) => {
    const key = `${f.field}.${f.slot}`
    if (
      !open.has(key) ||
      seen.has(key) ||
      !f.value.trim() ||
      !quoteSupported(f.quote, [docText])
    )
      return false
    seen.add(key)
    return true
  })
}

/** Pre-fill open slots from a document and mark them as needing one confirmation. */
export function applyDocFacts(
  session: Session,
  fills: readonly DocFill[],
  source: string
): Session {
  const by = new Map(fills.map((f) => [`${f.field}.${f.slot}`, f]))
  return {
    ...session,
    fields: session.fields.map((f) => ({
      ...f,
      slots: f.slots.map((s) => {
        const m = by.get(`${f.id}.${s.name}`)
        return m && s.value === null && !s.skipped
          ? {
              ...s,
              value: m.value.trim(),
              quote: m.quote.trim(),
              fromProfile: true,
              source,
            }
          : s
      }),
    })),
  }
}
