import { neonAuth } from "@/lib/auth/server"
import { githubClientId } from "@/lib/github-device"
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
    sync: auth && Boolean(profileStore()),
    github: Boolean(githubClientId()),
  }
  return Response.json(health)
}
