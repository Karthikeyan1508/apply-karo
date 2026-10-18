import type { ProfileItem } from "./types"

/** The sections the profile screen groups facts into. */
export const SECTIONS = [
  "Identity",
  "Links",
  "Education",
  "Experience",
  "Projects",
  "Skills",
  "Other",
] as const
export type Section = (typeof SECTIONS)[number]

export interface CanonicalField {
  key: string
  /** The question as a form would ask it. Also the label of the stored fact. */
  label: string
  /** The one spoken question that fills it, when it is missing. */
  ask: string
  section: Section
  /** Matches a form question that asks for this field. */
  match: RegExp
}

/** The checklist of fields application and loan forms commonly ask for. */
export const CHECKLIST: CanonicalField[] = [
  {
    key: "full_name",
    label: "Full name",
    ask: "What is your full name?",
    section: "Identity",
    match: /^(your\s+)?(legal\s+|full\s+)?name\??$|full name/i,
  },
  {
    key: "email",
    label: "Email",
    ask: "What is your email address?",
    section: "Identity",
    match: /e-?mail/i,
  },
  {
    key: "phone",
    label: "Phone number",
    ask: "What is your phone number?",
    section: "Identity",
    match: /phone|mobile|contact number/i,
  },
  {
    key: "city",
    label: "City",
    ask: "Which city are you based in?",
    section: "Identity",
    match: /\b(city|current location|based in)\b/i,
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    ask: "What is your LinkedIn profile link?",
    section: "Links",
    match: /linkedin/i,
  },
  {
    key: "github",
    label: "GitHub",
    ask: "What is your GitHub profile link?",
    section: "Links",
    match: /github/i,
  },
  {
    key: "portfolio",
    label: "Portfolio or website",
    ask: "Do you have a portfolio or personal website? Share the link.",
    section: "Links",
    match: /portfolio|personal (site|website)|website/i,
  },
  {
    key: "current_company",
    label: "Current company",
    ask: "Where do you work now?",
    section: "Experience",
    match: /current (company|employer|organi[sz]ation)/i,
  },
  {
    key: "current_role",
    label: "Current role",
    ask: "What is your current job title?",
    section: "Experience",
    match: /current (role|designation|title|position)/i,
  },
  {
    key: "years_experience",
    label: "Years of experience",
    ask: "How many years of work experience do you have?",
    section: "Experience",
    match: /years? of (total )?(work )?experience|experience in years/i,
  },
  {
    key: "highest_education",
    label: "Highest education",
    ask: "What is your highest education, such as B.Tech or MBA?",
    section: "Education",
    match: /highest (education|qualification)|\bdegree\b/i,
  },
  {
    key: "college",
    label: "College or university",
    ask: "Which college or university did you study at?",
    section: "Education",
    match: /college|university|institute/i,
  },
  {
    key: "graduation_year",
    label: "Graduation year",
    ask: "In which year did you graduate?",
    section: "Education",
    match: /graduation year|year of (graduation|passing)/i,
  },
  {
    key: "skills",
    label: "Key skills",
    ask: "What are your main skills?",
    section: "Skills",
    match: /\bskills?\b|tech stack/i,
  },
  {
    key: "notice_period",
    label: "Notice period",
    ask: "What is your notice period?",
    section: "Other",
    match: /notice period/i,
  },
  {
    key: "current_ctc",
    label: "Current CTC",
    ask: "What is your current CTC? You can skip this.",
    section: "Other",
    match: /current (ctc|salary|compensation)/i,
  },
  {
    key: "expected_ctc",
    label: "Expected CTC",
    ask: "What CTC do you expect? You can skip this.",
    section: "Other",
    match: /expected (ctc|salary|compensation)/i,
  },
  {
    key: "work_authorisation",
    label: "Work authorisation",
    ask: "Are you allowed to work in the country this role is in?",
    section: "Other",
    match: /work authori[sz]ation|authori[sz]ed to work|visa|right to work/i,
  },
  {
    key: "preferred_roles",
    label: "Preferred roles",
    ask: "What kind of roles are you looking for?",
    section: "Other",
    match:
      /preferred (role|position)s?|roles? (you|are you) (interested|looking)/i,
  },
  {
    key: "why_role",
    label: "Why this kind of role",
    ask: "Why do you want this kind of role?",
    section: "Other",
    match: /why (do you want|this role|are you interested|join)/i,
  },
  {
    key: "headline_achievement",
    label: "Headline achievement",
    ask: "What is your best achievement, with a number if you can?",
    section: "Other",
    match: /achievement|proudest|biggest (win|result)/i,
  },
]

const BY_KEY = new Map(CHECKLIST.map((c) => [c.key, c]))

/** The canonical key a form question asks for, or null. */
export function keyOf(label: string): string | null {
  const hit = CHECKLIST.find((c) => c.match.test(label.trim()))
  return hit ? hit.key : null
}

/** Values the user must confirm before they are filled in automatically. */
const SENSITIVE =
  /\b(gender|sex|date of birth|dob|birth ?date|caste|category|disab\w*|salary|ctc|compensation|current pay|aadhaar|aadhar|pan|passport|government id|ssn|marital|religion|blood group)\b/i

export function isSensitive(key: string, label = ""): boolean {
  return SENSITIVE.test(`${key.replace(/[:_-]/g, " ")} ${label}`)
}

const PREFIXES: Record<string, Section> = {
  experience: "Experience",
  project: "Projects",
  education: "Education",
  skill: "Skills",
}

/** Which section a fact belongs to, from its key. */
export function sectionOf(item: Pick<ProfileItem, "key">): Section {
  const key = item.key ?? ""
  const canon = BY_KEY.get(key)
  if (canon) return canon.section
  const prefix = key.split(":")[0]
  return PREFIXES[prefix] ?? "Other"
}

const ALLOWED_PREFIX =
  /^(experience|project|education|skill|certification|achievement|language|other):/

/**
 * A key from the model or a file, made safe: canonical keys stay, list items keep an allowed prefix,
 * and anything else becomes `other:<slug>`.
 */
export function canonicalKey(raw: string, label = ""): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_")
  if (BY_KEY.has(key)) return key
  if (ALLOWED_PREFIX.test(key)) {
    const [prefix, ...rest] = key.split(":")
    const slug = rest
      .join(":")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
    return `${prefix}:${slug || "item"}`
  }
  const slug = (label || raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return `other:${slug || "fact"}`
}

/** The label a canonical fact is stored under, so the same question always has the same label. */
export function canonicalLabel(key: string, fallback: string): string {
  return BY_KEY.get(key)?.label ?? fallback
}

export function checklistEntry(key: string): CanonicalField | undefined {
  return BY_KEY.get(key)
}
