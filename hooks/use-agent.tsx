"use client"

import {
  ConversationProvider,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { toast } from "sonner"
import { classifyAgentError, type AgentError } from "@/lib/agent-errors"
import { agentLanguage, buildDynamicVariables } from "@/lib/core"
import { demoSteps } from "@/lib/demo"
import { bandsFrom, BANDS, fakeBands } from "@/lib/spectrum"
import { rewriteField } from "@/lib/draft-client"
import type { Channel } from "@/lib/interview-store"
import {
  handleEditAnswer,
  handleFinishInterview,
  handleRecordAnswers,
} from "@/lib/tools"
import type { ApiError, VoiceSessionInfo } from "@/lib/types"
import { useInterviewStore } from "./use-interview"

export type AgentStatus = "idle" | "connecting" | "live" | "ended"
export type AgentMode = "idle" | "listening" | "speaking"

export interface AgentApi {
  channel: Channel | null
  status: AgentStatus
  mode: AgentMode
  muted: boolean
  demoSpeed: 1 | 2
  /** Why the last start or call failed, or null. Cleared by the next start. */
  error: AgentError | null
  start: (kind: Channel) => Promise<void>
  stop: () => void
  setMuted: (muted: boolean) => void
  sendText: (text: string) => void
  setDemoSpeed: (speed: 1 | 2) => void
  clearError: () => void
  /** 0..1 microphone and speaker levels, read every animation frame. */
  getLevels: () => { input: number; output: number }
  /** 16 smooth 0..1 frequency bands for whoever is talking, read every animation frame. */
  getSpectrum: () => number[]
}

const AgentContext = createContext<AgentApi | null>(null)

export function useAgent(): AgentApi {
  const api = useContext(AgentContext)
  if (!api) throw new Error("useAgent must be used inside AgentProvider")
  return api
}

/** Why the microphone can't be used right now, or null when it should work. */
async function micProblem(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This page can't reach a microphone: it needs https or localhost."
  }
  try {
    const perm = await navigator.permissions.query({ name: "microphone" as PermissionName })
    if (perm.state === "denied") return "Microphone permission denied."
  } catch {
    // Some browsers can't query this permission. Let the connection find out.
  }
  return null
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

/** Wraps the ElevenLabs conversation, a scripted demo replay and typed chat behind one API. */
export function AgentProvider({ children }: { children: ReactNode }) {
  return (
    <ConversationProvider>
      <AgentInner>{children}</AgentInner>
    </ConversationProvider>
  )
}

function AgentInner({ children }: { children: ReactNode }) {
  const store = useInterviewStore()
  const controls = useConversationControls()
  const { status: convStatus, message: convMessage } = useConversationStatus()
  const { mode: convMode } = useConversationMode()
  const { isMuted, setMuted } = useConversationInput()

  const [channel, setChannel] = useState<Channel | null>(null)
  const [voiceEnded, setVoiceEnded] = useState(false)
  const [demoMode, setDemoMode] = useState<AgentMode>("idle")
  const [demoStatus, setDemoStatus] = useState<AgentStatus>("idle")
  const [demoSpeed, setDemoSpeedState] = useState<1 | 2>(1)
  const [startError, setError] = useState<AgentError | null>(null)
  const [sdkDismissed, setSdkDismissed] = useState(false)
  const speedRef = useRef<1 | 2>(1)
  const abortRef = useRef<AbortController | null>(null)

  // Set the ref now, not in an effect: a replay started in the same tick must use this speed.
  const setDemoSpeed = useCallback((speed: 1 | 2) => {
    speedRef.current = speed
    setDemoSpeedState(speed)
  }, [])
  const clearError = useCallback(() => {
    setError(null)
    setSdkDismissed(true)
  }, [])

  // The SDK reports a failed connection through its status as well as onError.
  const sdkError = useMemo(
    () => (convStatus === "error" && !sdkDismissed ? classifyAgentError(convMessage ?? "") : null),
    [convStatus, convMessage, sdkDismissed]
  )
  const error = startError ?? sdkError

  // Client tools: names must match the tools defined in the ElevenLabs dashboard (see /setup).
  const tools = useMemo(
    () => ({
      record_answers: (p: Record<string, unknown>) =>
        handleRecordAnswers(store, p.updates),
      finish_interview: () => handleFinishInterview(store),
      edit_answer: (p: Record<string, unknown>) =>
        handleEditAnswer(store, p, async (fieldId, instruction) => {
          const r = await rewriteField(store, fieldId, instruction)
          return "text" in r ? r.text : null
        }),
    }),
    [store]
  )

  const stopAll = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    try {
      controls.endSession()
    } catch {
      // not connected
    }
    setDemoMode("idle")
    setDemoStatus("idle")
  }, [controls])

  const runDemo = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const wait = (ms: number) => sleep(ms / speedRef.current, ac.signal)

    const current = store.getState().session
    const steps = demoSteps(current?.lang === "hi-IN" ? "hi-IN" : "en-IN", current?.id)
    store.dispatch({ type: "restart" })
    store.dispatch({ type: "channel", channel: "demo" })
    setChannel("demo")
    setDemoStatus("live")
    setDemoMode("idle")
    await wait(500)

    for (const step of steps) {
      if (ac.signal.aborted) return
      if (step.kind === "agent") {
        setDemoMode("speaking")
        store.dispatch({ type: "utterance", role: "agent", text: step.text })
        await wait(Math.min(7000, Math.max(1500, step.text.length * 42)))
      } else if (step.kind === "user") {
        setDemoMode("listening")
        await wait(500)
        const words = step.text.split(" ")
        for (let i = 1; i <= words.length; i++) {
          if (ac.signal.aborted) return
          store.dispatch({
            type: "utterance",
            role: "user",
            text: words.slice(0, i).join(" "),
          })
          await wait(120)
        }
        await wait(350)
      } else if (step.kind === "tools") {
        await wait(250)
        store.dispatch({ type: "updates", updates: step.updates })
        await wait(550)
      } else {
        handleFinishInterview(store)
      }
    }
    if (!ac.signal.aborted) {
      setDemoMode("idle")
      setDemoStatus("ended")
    }
  }, [store])

  const start = useCallback(
    async (kind: Channel) => {
      const session = store.getState().session
      if (!session) return
      stopAll()
      setVoiceEnded(false)
      setError(null)
      setSdkDismissed(false)

      if (kind === "demo") {
        await runDemo()
        return
      }

      // A blocked microphone is known before connecting, so don't spend a session on it.
      if (kind === "voice") {
        const blocked = await micProblem()
        if (blocked) {
          setError(classifyAgentError(blocked))
          return
        }
      }

      let info: VoiceSessionInfo
      try {
        const res = await fetch("/api/voice/session", { cache: "no-store" })
        const body = (await res.json()) as VoiceSessionInfo | ApiError
        if (!res.ok || "error" in body) {
          setError(classifyAgentError("error" in body ? body.error.message : "", "error" in body ? body.error.code : undefined))
          return
        }
        info = body
      } catch (e) {
        setError(classifyAgentError(e instanceof Error ? e : "Failed to fetch"))
        return
      }

      // No restart here: answers pre-filled from a saved profile must survive into the call.
      store.dispatch({ type: "channel", channel: kind })
      setChannel(kind)

      const language = agentLanguage(session)
      const common = {
        dynamicVariables: buildDynamicVariables(session),
        clientTools: tools,
        textOnly: kind === "text",
        ...(language ? { overrides: { agent: { language } } } : {}),
        onMessage: (m: { role: "user" | "agent"; message: string }) =>
          store.dispatch({ type: "utterance", role: m.role, text: m.message }),
        onError: (message: string) => {
          setError(classifyAgentError(message))
          toast.error("Voice agent error", { description: message })
        },
        onDisconnect: () => setVoiceEnded(true),
      }

      if (info.mode === "public") {
        controls.startSession({ agentId: info.agentId, ...common })
      } else if (info.mode === "token") {
        controls.startSession({ conversationToken: info.conversationToken, ...common })
      } else {
        controls.startSession({ signedUrl: info.signedUrl, ...common })
      }
    },
    [controls, runDemo, stopAll, store, tools]
  )

  const stop = useCallback(() => {
    stopAll()
    store.dispatch({ type: "channel", channel: null })
    setChannel(null)
  }, [stopAll, store])

  const sendText = useCallback(
    (text: string) => {
      const clean = text.trim()
      if (!clean || channel === "demo") return
      // The guard checks quotes against what the user said, so typed text must be recorded too.
      store.dispatch({ type: "utterance", role: "user", text: clean })
      controls.sendUserMessage(clean)
    },
    [channel, controls, store]
  )

  const voiceStatus: AgentStatus =
    convStatus === "connecting"
      ? "connecting"
      : convStatus === "connected"
        ? "live"
        : voiceEnded
          ? "ended"
          : "idle"
  const status: AgentStatus =
    channel === "demo" ? demoStatus : channel ? voiceStatus : "idle"
  const mode: AgentMode =
    channel === "demo"
      ? demoMode
      : status === "live"
        ? convMode === "speaking"
          ? "speaking"
          : "listening"
        : "idle"

  const getLevels = useCallback(() => {
    if (channel === "demo") {
      const t = performance.now()
      const wobble = 0.5 + 0.5 * Math.sin(t / 83) * Math.sin(t / 211)
      return {
        input: demoMode === "listening" ? 0.15 + 0.5 * wobble : 0.02,
        output: demoMode === "speaking" ? 0.2 + 0.6 * wobble : 0,
      }
    }
    if (status !== "live" || channel === "text") return { input: 0, output: 0 }
    try {
      return {
        input: controls.getInputVolume(),
        output: controls.getOutputVolume(),
      }
    } catch {
      return { input: 0, output: 0 }
    }
  }, [channel, controls, demoMode, status])

  const getSpectrum = useCallback((): number[] => {
    const quiet = new Array<number>(BANDS).fill(0)
    if (mode === "idle") return quiet
    if (channel === "demo") {
      return fakeBands(performance.now(), mode === "speaking" ? 0.85 : 0.6)
    }
    if (status !== "live" || channel === "text") return quiet
    try {
      return bandsFrom(
        mode === "speaking" ? controls.getOutputByteFrequencyData() : controls.getInputByteFrequencyData()
      )
    } catch {
      return quiet
    }
  }, [channel, controls, mode, status])

  const api = useMemo<AgentApi>(
    () => ({
      channel,
      status,
      mode,
      muted: isMuted,
      demoSpeed,
      error,
      start,
      stop,
      setMuted,
      sendText,
      setDemoSpeed,
      clearError,
      getLevels,
      getSpectrum,
    }),
    [channel, status, mode, isMuted, demoSpeed, error, start, stop, setMuted, sendText, setDemoSpeed, clearError, getLevels, getSpectrum]
  )

  return <AgentContext value={api}>{children}</AgentContext>
}
