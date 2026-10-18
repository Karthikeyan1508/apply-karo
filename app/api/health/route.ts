import { formsConfig } from "@/lib/auth"
import { neonAuth } from "@/lib/auth/server"
import { llmConfigured } from "@/lib/llm"
import { profileStore } from "@/lib/profile-store"
import type { Health } from "@/lib/types"

export async function GET() {
  const auth = Boolean(neonAuth())
  const health: Health = {
    llm: llmConfigured(),
    voice: Boolean(process.env.ELEVENLABS_AGENT_ID),
    voicePrivate: Boolean(process.env.ELEVENLABS_API_KEY),
    auth,
    forms: auth && Boolean(formsConfig()),
    sync: auth && Boolean(profileStore()),
  }
  return Response.json(health)
}
