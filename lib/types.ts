export interface Slot {
  name: string
  /** One short spoken question that would fill this slot. */
  ask: string
  value: string | null
  /** The user's verbatim words that back `value`. */
  quote: string | null
  skipped: boolean
  /** Pre-filled from an earlier form or a document; needs one confirmation. */
  fromProfile: boolean
  /** Where a pre-filled fact came from, shown to the user, for example "resume.pdf". */
  source?: string
}

export type FieldKind = "text" | "long_text" | "choice"

export interface RawField {
  /** Position among all items in the live form. Used by the filler later. */
  index: number
  /** Google Forms entry id, e.g. "123456789" for `entry.123456789`. */
  entryId: string | null
  label: string
  kind: FieldKind
  options: string[]
  multi: boolean
  required: boolean
}

export interface FormField extends RawField {
  id: string
  /** What the form owner really wants to learn. */
  intent: string
  slots: Slot[]
  maxChars: number | null
  draft: string
  /** Signature of the confirmed facts the current draft was written from. Empty when never drafted. */
  draftSig: string
  /** The user changed the draft by hand or by a rewrite request: never auto-redraft it. */
  edited: boolean
  flags: string[]
  /** Whether the interviewer understood the question and has what it needs, checked before any answer is filled. */
  check?: { understood: boolean; enough: boolean; needs: string }
  /** A bounded follow-up about a project or role, built from compact reviewed facts. */
  grill?: {
    subjectKey: string
    category:
      | "ownership"
      | "decision"
      | "tradeoff"
      | "impact"
      | "outcome"
      | "motivation"
  }
}

/**
 * A fact saved to pre-fill later forms. The optional fields were added with the onboarding profile:
 * older saved data has none of them and still loads.
 */
export interface ProfileItem {
  label: string
  slot: string
  value: string
  quote: string
  form: string
  savedAt: number
  /** Canonical key such as `full_name`, or `project:<slug>` for a list item. */
  key?: string
  /** Where the fact came from, for example "resume.pdf", "github", "linkedin" or "interview". */
  source?: string
  /** The user approved this fact in onboarding review or in the profile screen. */
  confirmed?: boolean
  /** A fact the user must confirm before it is applied, unless `autofill` is set. */
  sensitive?: boolean
  /** The user explicitly allowed a sensitive fact to be filled in automatically. */
  autofill?: boolean
  /** Read from the person's resume. Used to fill forms but never listed on the Profile screen. */
  hidden?: boolean
  /** A reusable clarification about a project or role, never broadly autofilled. */
  kind?: "decision"
  /** The project or experience fact this decision belongs to. */
  subjectKey?: string
  category?:
    "ownership" | "decision" | "tradeoff" | "impact" | "outcome" | "motivation"
}

export type SessionSource = "google" | "text" | "demo" | "page" | "onboarding"

export interface Session {
  id: string
  title: string
  description: string
  source: SessionSource
  formUrl: string | null
  /** Job description, product notes, etc. Treated as data, never instructions. */
  context: string
  lang: string
  fields: FormField[]
  /** Distinguishes source-aware deepening from the optional standard profile gaps. */
  onboardingPurpose?: "grill" | "gaps"
  /**
   * A question about the person's projects, when their GitHub is connected: which repos to use for it,
   * asked in the chat. `leftover` is what the chosen repos could not answer and the interview still asks.
   */
  projectChoice?: { fieldId: string; stage: "ask" | "working" | "done" | "skipped"; repos: string[]; leftover: string[]; summaries?: { repo: string; text: string }[] }
}

export interface SlotUpdate {
  field: string
  slot: string
  value?: string
  quote?: string
  skip?: boolean
}

export interface Rejection {
  update: SlotUpdate
  reason: string
}

export interface GuardEvent {
  id: string
  at: number
  update: SlotUpdate
  accepted: boolean
  reason?: string
}

export interface TranscriptLine {
  id: string
  role: "user" | "agent"
  text: string
  at: number
}

export interface ApiError {
  error: { code: string; message: string }
}

/** How the browser should connect to the ElevenLabs agent. */
export type VoiceSessionInfo =
  | { mode: "public"; agentId: string }
  | { mode: "token"; agentId: string; conversationToken: string }
  | { mode: "signed"; agentId: string; signedUrl: string }

export interface Health {
  llm: boolean
  voice: boolean
  voicePrivate: boolean
  /** Neon Auth (Google sign-in) is configured. */
  auth: boolean
  /** A database for syncing saved facts is configured. */
  sync: boolean
  /** A GitHub OAuth app is configured, so an account (private repos included) can be connected. */
  github: boolean
}

/** What the browser is told about the signed-in user. Never the tokens. */
export interface AuthInfo {
  configured: boolean
  sync: boolean
  user: { name: string; email: string; picture?: string } | null
}
