import { existsSync, readFileSync } from "node:fs"

/** .env.local merged under the real environment. Never log the result: it holds the keys. */
export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=")
      if (line.trim() && !line.startsWith("#") && i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
  }
  return { ...out, ...(process.env as Record<string, string>) }
}

/**
 * How a script reaches the agent: a signed URL when there is an API key (this keeps working after the
 * agent is made private), otherwise the bare agent id.
 */
export async function agentConnection(
  env: Record<string, string>
): Promise<{ agentId: string } | { signedUrl: string }> {
  const agentId = env.ELEVENLABS_AGENT_ID
  if (env.ELEVENLABS_API_KEY) {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
        { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } }
      )
      const body = (await res.json()) as { signed_url?: string }
      if (res.ok && body.signed_url) return { signedUrl: body.signed_url }
    } catch {
      // fall back to the public path
    }
  }
  return { agentId }
}
