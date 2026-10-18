import { applyUpdates, draftFlags, newId } from "./core.ts"
import type { SavedState } from "./persist"
import type {
  GuardEvent,
  Rejection,
  Session,
  SlotUpdate,
  TranscriptLine,
} from "./types"

/** landing, then interview, then review ("complete"), then handed over ("approved"). */
export type Phase = "landing" | "interview" | "complete" | "approved"
export type Channel = "voice" | "text" | "demo"

export interface InterviewState {
  phase: Phase
  session: Session | null
  channel: Channel | null
  transcript: TranscriptLine[]
  /** Everything the user said, used by the quote guard. */
  said: string[]
  guardLog: GuardEvent[]
  lastFieldId: string | null
  lastApply: { accepted: SlotUpdate[]; rejected: Rejection[] } | null
  /** Field ids with a draft request in flight. */
  drafting: string[]
  /** When the interview first started, and when it finished and how, for the time-saved line. */
  startedAt: number | null
  finishedAt: number | null
  finishedVia: Channel | null
}

export type Action =
  | { type: "session"; session: Session }
  | { type: "channel"; channel: Channel | null }
  | { type: "utterance"; role: "user" | "agent"; text: string; at?: number }
  | { type: "updates"; updates: SlotUpdate[]; at?: number }
  | { type: "drafting"; ids: string[]; on: boolean }
  | {
      type: "draft"
      fieldId: string
      text: string
      flags: string[]
      sig: string
      /** A rewrite request counts as the user's own edit. */
      edited?: boolean
    }
  | { type: "edit"; fieldId: string; text: string }
  | { type: "finish" }
  | { type: "hydrate"; saved: SavedState; savedAt: number }
  | { type: "approve" }
  | { type: "reopen" }
  | { type: "restart" }
  | { type: "reset" }

export function initialState(): InterviewState {
  return {
    phase: "landing",
    session: null,
    channel: null,
    transcript: [],
    said: [],
    guardLog: [],
    lastFieldId: null,
    lastApply: null,
    drafting: [],
    startedAt: null,
    finishedAt: null,
    finishedVia: null,
  }
}

/** Clear all captured answers but keep the form plan. */
function blank(session: Session): Session {
  return {
    ...session,
    fields: session.fields.map((f) => ({
      ...f,
      draft: "",
      draftSig: "",
      edited: false,
      flags: [],
      slots: f.slots.map((s) => ({
        ...s,
        value: null,
        quote: null,
        skipped: false,
        fromProfile: false,
        source: undefined,
      })),
    })),
  }
}

const MERGE_WINDOW_MS = 4000

/** Speech-to-text sends growing partials. Fold them into one line instead of stacking. */
function addUtterance(
  state: InterviewState,
  role: "user" | "agent",
  text: string,
  at: number
): Pick<InterviewState, "transcript" | "said"> {
  const clean = text.trim()
  if (!clean) return { transcript: state.transcript, said: state.said }
  const last = state.transcript[state.transcript.length - 1]

  if (
    last &&
    last.role === role &&
    at - last.at < (role === "user" ? MERGE_WINDOW_MS : 1000) &&
    (clean.startsWith(last.text) || last.text.startsWith(clean))
  ) {
    const longer = clean.length >= last.text.length ? clean : last.text
    const transcript = [
      ...state.transcript.slice(0, -1),
      { ...last, text: longer, at },
    ]
    const said =
      role === "user" && state.said.length
        ? [...state.said.slice(0, -1), longer]
        : state.said
    return { transcript, said }
  }

  return {
    transcript: [
      ...state.transcript,
      { id: newId("t"), role, text: clean, at },
    ],
    said: role === "user" ? [...state.said, clean] : state.said,
  }
}

function mapField(
  state: InterviewState,
  fieldId: string,
  change: (f: Session["fields"][number]) => Session["fields"][number]
): InterviewState {
  if (!state.session) return state
  return {
    ...state,
    session: {
      ...state.session,
      fields: state.session.fields.map((f) => (f.id === fieldId ? change(f) : f)),
    },
  }
}

export function reduce(state: InterviewState, action: Action): InterviewState {
  switch (action.type) {
    case "session":
      return {
        ...initialState(),
        phase: "interview",
        session: action.session,
        startedAt: null,
      }
    case "channel":
      return {
        ...state,
        channel: action.channel,
        startedAt: action.channel ? (state.startedAt ?? Date.now()) : state.startedAt,
      }
    case "utterance":
      return {
        ...state,
        ...addUtterance(state, action.role, action.text, action.at ?? Date.now()),
      }
    case "updates": {
      if (!state.session) return state
      const at = action.at ?? Date.now()
      const res = applyUpdates(state.session, action.updates, state.said)
      const events: GuardEvent[] = [
        ...res.accepted.map((update) => ({
          id: newId("g"),
          at,
          update,
          accepted: true,
        })),
        ...res.rejected.map((r) => ({
          id: newId("g"),
          at,
          update: r.update,
          accepted: false,
          reason: r.reason,
        })),
      ]
      return {
        ...state,
        session: res.session,
        guardLog: [...state.guardLog, ...events],
        lastFieldId:
          res.changedFieldIds[res.changedFieldIds.length - 1] ?? state.lastFieldId,
        lastApply: { accepted: res.accepted, rejected: res.rejected },
      }
    }
    case "drafting": {
      const rest = state.drafting.filter((id) => !action.ids.includes(id))
      return { ...state, drafting: action.on ? [...rest, ...action.ids] : rest }
    }
    case "draft":
      return mapField(state, action.fieldId, (f) => ({
        ...f,
        draft: action.text,
        flags: action.flags,
        draftSig: action.sig,
        edited: action.edited ?? f.edited,
      }))
    case "edit":
      return mapField(state, action.fieldId, (f) => ({
        ...f,
        draft: action.text,
        edited: true,
        flags: draftFlags(f, action.text),
      }))
    case "finish":
      return state.session && state.phase === "interview"
        ? { ...state, phase: "complete", finishedAt: Date.now(), finishedVia: state.channel }
        : state
    case "hydrate": {
      // Shift the clock so the time spent away is not counted as time spent interviewing.
      const away = Date.now() - action.savedAt
      const { startedAt, finishedAt } = action.saved
      return {
        ...initialState(),
        ...action.saved,
        startedAt: startedAt === null ? null : startedAt + away,
        finishedAt: finishedAt === null ? null : finishedAt + away,
      }
    }
    case "approve":
      return state.session && state.phase === "complete"
        ? { ...state, phase: "approved" }
        : state
    case "reopen":
      return state.phase === "approved" ? { ...state, phase: "complete" } : state
    case "restart":
      return state.session
        ? {
            ...initialState(),
            phase: "interview",
            session: blank(state.session),
          }
        : state
    case "reset":
      return initialState()
  }
}

export function createInterviewStore(initial: InterviewState = initialState()) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispatch(action: Action) {
      state = reduce(state, action)
      listeners.forEach((l) => l())
      return state
    },
  }
}

export type InterviewStore = ReturnType<typeof createInterviewStore>
