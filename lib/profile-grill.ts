import { newId } from "./core"
import type { FormField, ProfileItem, Session } from "./types"

export const GRILL_LIMIT = 6

export const GRILL_CATEGORIES = [
  "ownership",
  "decision",
  "tradeoff",
  "impact",
  "outcome",
  "motivation",
] as const

export type GrillCategory = (typeof GRILL_CATEGORIES)[number]

export interface GrillQuestion {
  subjectKey: string
  label: string
  question: string
  category: GrillCategory
}

const category = (value: string): value is GrillCategory =>
  (GRILL_CATEGORIES as readonly string[]).includes(value)

/** Reject model output that cannot be tied to one compact reviewed source fact. */
export function validGrillQuestions(
  raw: readonly GrillQuestion[],
  facts: readonly Pick<ProfileItem, "key">[]
): GrillQuestion[] {
  const subjects = new Set(
    facts
      .filter((f) => /^(project|experience):/.test(f.key ?? ""))
      .map((f) => f.key)
  )
  const seen = new Set<string>()
  return raw
    .flatMap((q) => {
      const subjectKey = q.subjectKey?.trim()
      const question = q.question?.trim().slice(0, 220)
      const label = q.label?.trim().slice(0, 120)
      const id = `${subjectKey}:${q.category}`
      if (
        !subjectKey ||
        !question ||
        !label ||
        !category(q.category) ||
        !subjects.has(subjectKey) ||
        seen.has(id)
      )
        return []
      seen.add(id)
      return [{ subjectKey, label, question, category: q.category }]
    })
    .slice(0, GRILL_LIMIT)
}

/** A deliberately small onboarding interview: the agent sees six questions, not the source documents. */
export function grillSession(
  questions: readonly GrillQuestion[],
  lang = "en-IN"
): Session {
  return {
    id: newId("s"),
    title: "Your profile",
    description: "A few questions to make your projects and experience clearer",
    source: "onboarding",
    formUrl: null,
    context: "",
    lang,
    onboardingPurpose: "grill",
    fields: questions.map((q, index): FormField => ({
      id: `grill_${index + 1}`,
      index,
      entryId: null,
      label: q.label,
      kind: "long_text",
      options: [],
      multi: false,
      required: false,
      intent: q.question,
      slots: [
        {
          name: "answer",
          ask: q.question,
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
      grill: { subjectKey: q.subjectKey, category: q.category },
    })),
  }
}
