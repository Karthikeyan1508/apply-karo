import { AppError, errorResponse } from "@/lib/errors"
import type { VoiceSessionInfo } from "@/lib/types"

const BASE = "https://api.elevenlabs.io/v1/convai/conversation"

async function getJson(path: string, agentId: string, apiKey: string) {
  const res = await fetch(`${BASE}/${path}?agent_id=${encodeURIComponent(agentId)}`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  return res.ok ? ((await res.json()) as Record<string, unknown>) : null
}

/**
 * Public agent: the browser connects with just the agent id.
 * Private agent (ELEVENLABS_API_KEY set): mint a short-lived WebRTC token, falling back to a
 * signed WebSocket URL, so the API key never reaches the browser.
 */
export async function GET() {
  try {
    const agentId = process.env.ELEVENLABS_AGENT_ID
    if (!agentId) {
      throw new AppError(
        "VOICE_NOT_CONFIGURED",
        503,
        "No ElevenLabs agent configured. Set ELEVENLABS_AGENT_ID in .env.local (see /setup)."
      )
    }
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      return Response.json({ mode: "public", agentId } satisfies VoiceSessionInfo)
    }

    const token = (await getJson("token", agentId, apiKey))?.token
    if (typeof token === "string") {
      return Response.json({ mode: "token", agentId, conversationToken: token } satisfies VoiceSessionInfo)
    }
    const signed = (await getJson("get-signed-url", agentId, apiKey))?.signed_url
    if (typeof signed === "string") {
      return Response.json({ mode: "signed", agentId, signedUrl: signed } satisfies VoiceSessionInfo)
    }
    throw new AppError(
      "VOICE_AUTH_FAILED",
      502,
      "ElevenLabs refused the request. Check ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID."
    )
  } catch (e) {
    return errorResponse(e)
  }
}
