import { newId } from "./core"
import { CHECKLIST, isSensitive, sectionOf, type Section } from "./profile-keys"
import type { FormField, ProfileItem, Session } from "./types"

/** Enough questions for one sitting. Weak items come after the checklist, so they never crowd it out. */
export const MAX_GAPS = 14
const MAX_WEAK = 4

export interface Gap {
  /** Also the field id of the onboarding session, and the key of the fact the answer will become. */
  key: string
  label: string
  ask: string
  section: Section
  /** A list item that is missing a number or an outcome. The answer is free text. */
  weak: boolean
  sensitive: boolean
}

const HAS_NUMBER = /\d/

/** The part of a list item's label after "Project:" or "Experience:", used in the question. */
function nameOf(item: ProfileItem): string {
  return (
    item.label.replace(/^(project|experience|education)\s*:\s*/i, "").trim() ||
    "this"
  )
}

/**
 * What the saved facts do not answer. Canonical checklist questions with no fact come first, then list
 * items (projects, roles) whose fact has no number, since a number is what makes an answer strong.
 * Never asks again about a key the facts already answer.
 */
export function findGaps(facts: readonly ProfileItem[]): Gap[] {
  const have = new Set(facts.map((f) => f.key).filter(Boolean))
  const canon: Gap[] = CHECKLIST.filter((c) => c.ask && !have.has(c.key)).map((c) => ({
    key: c.key,
    label: c.label,
    ask: c.ask,
    section: c.section,
    weak: false,
    sensitive: isSensitive(c.key, c.label),
  }))

  const weak: Gap[] = []
  for (const f of facts) {
    const key = f.key ?? ""
    if (!/^(project|experience):/.test(key) || HAS_NUMBER.test(f.value))
      continue
    const name = nameOf(f)
    const isProject = key.startsWith("project:")
    weak.push({
      key: `${key}:impact`,
      label: isProject ? `Result of ${name}` : `Impact at ${name}`,
      ask: isProject
        ? `What changed because of ${name}? A number helps, like users or time saved.`
        : `What did you achieve at ${name}? A number helps, like sales, team size or savings.`,
      section: isProject ? "Projects" : "Experience",
      weak: true,
      sensitive: false,
    })
  }
  // Weak list items get a few places of their own, so a long checklist never pushes them out.
  const shown = weak.slice(0, MAX_WEAK)
  return [...canon.slice(0, MAX_GAPS - shown.length), ...shown]
}

/**
 * A synthetic interview session whose fields are the gaps. It runs through the same interview machinery
 * as a form: the same agent, quote guard and review. Field ids are the fact keys, so the answers can be
 * saved back under the right keys.
 */
export function onboardingSession(
  gaps: readonly Gap[],
  lang = "en-IN"
): Session {
  return {
    id: newId("s"),
    title: "Your profile",
    description: "Questions the sources did not answer",
    source: "onboarding",
    formUrl: null,
    context: "",
    lang,
    fields: gaps.map((g, index): FormField => ({
      id: g.key,
      index,
      entryId: null,
      label: g.label,
      kind: g.weak ? "long_text" : "text",
      options: [],
      multi: false,
      required: false,
      intent: g.ask,
      slots: [
        {
          name: "answer",
          ask: g.ask,
          value: null,
          quote: null,
          skipped: false,
          fromProfile: false,
        },
      ],
      maxChars: null,
      draft: "",
      draftSig: "",
      edited: false,
      flags: [],
    })),
    onboardingPurpose: "gaps",
  }
}

/** The key and sensitivity of a session field, as they are stored. */
export function gapForField(f: Pick<FormField, "id" | "label">): {
  key: string
  sensitive: boolean
} {
  return { key: f.id, sensitive: isSensitive(f.id, f.label) }
}

/** Facts the onboarding interview captured: one per answered field, confirmed, with its quote. */
export function factsFromOnboarding(
  session: Session,
  now = Date.now()
): ProfileItem[] {
  return session.fields.flatMap((f) => {
    const s = f.slots[0]
    if (!s || s.value === null || s.fromProfile || !s.quote) return []
    const { key, sensitive } = gapForField(f)
    const grill = f.grill
    return [
      {
        label: grill ? `Decision: ${f.label}` : f.label,
        slot: "answer",
        value: s.value,
        quote: s.quote,
        form: "Your profile",
        savedAt: now,
        key: grill ? `${grill.subjectKey}:${grill.category}` : key,
        source: "interview",
        confirmed: true,
        sensitive: grill ? false : sensitive,
        ...(grill
          ? {
              kind: "decision" as const,
              subjectKey: grill.subjectKey,
              category: grill.category,
            }
          : {}),
      },
    ]
  })
}

/** Canonical section count for the done screen. */
export function countBySection(
  facts: readonly ProfileItem[]
): Partial<Record<Section, number>> {
  const out: Partial<Record<Section, number>> = {}
  for (const f of facts) {
    const s = sectionOf(f)
    out[s] = (out[s] ?? 0) + 1
  }
  return out
}
