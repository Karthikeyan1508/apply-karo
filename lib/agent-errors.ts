/** What went wrong with the voice agent, in words a person can act on. Pure, so it is tested. */

export type AgentErrorKind = "network" | "refused" | "mic" | "setup" | "agent"

export interface AgentError {
  kind: AgentErrorKind
  title: string
  detail: string
}

const TEXT: Record<Exclude<AgentErrorKind, "agent">, Omit<AgentError, "kind">> = {
  network: {
    title: "Can't reach the voice service",
    detail: "Check your connection and try again. The recorded demo works without a network.",
  },
  refused: {
    title: "ElevenLabs refused the connection",
    detail:
      "The key, the agent or your usage limit was turned down. Check ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID, and that the agent still exists.",
  },
  mic: {
    title: "The microphone is blocked",
    detail: "Allow it from the lock icon in the address bar and try again, or type your answers instead.",
  },
  setup: {
    title: "Voice isn't set up",
    detail: "Add ELEVENLABS_AGENT_ID to .env.local and restart. The setup guide has the steps.",
  },
}

/**
 * Sort an error into one of four causes. `code` is our own API's error code when the failure came
 * from /api/voice/session; otherwise only the message is available (the SDK, the browser, fetch).
 */
export function classifyAgentError(input: unknown, code?: string): AgentError {
  const message =
    typeof input === "string"
      ? input
      : input instanceof Error
        ? `${input.name}: ${input.message}`
        : input && typeof input === "object" && "message" in input
          ? String((input as { message: unknown }).message)
          : ""

  let kind: AgentErrorKind = "agent"
  if (code === "VOICE_NOT_CONFIGURED") kind = "setup"
  else if (code === "VOICE_AUTH_FAILED") kind = "refused"
  else if (/permission|denied|notallowed|microphone|getusermedia|notfound.*(device|media)/i.test(message)) kind = "mic"
  else if (/401|403|unauthori[sz]ed|forbidden|authenticat|invalid.*(key|token|agent)|quota|limit|exceed|private/i.test(message)) {
    kind = "refused"
  } else if (/failed to fetch|networkerror|network|offline|websocket|timed? ?out|econn|enotfound/i.test(message)) {
    kind = "network"
  }

  if (kind === "agent") {
    return {
      kind,
      title: "The voice agent stopped",
      detail: message.trim() ? message.trim().slice(0, 240) : "Try again. If it keeps happening, type your answers instead.",
    }
  }
  return { kind, ...TEXT[kind] }
}
