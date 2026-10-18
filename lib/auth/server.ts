import { createNeonAuth } from "@neondatabase/auth/next/server"

let cached: { key: string; auth: ReturnType<typeof createNeonAuth> } | null = null

/** Neon Auth, or null until NEON_AUTH_BASE_URL and a 32-character NEON_AUTH_COOKIE_SECRET are set. */
export function neonAuth(env: Record<string, string | undefined> = process.env) {
  const baseUrl = env.NEON_AUTH_BASE_URL?.trim()
  const secret = env.NEON_AUTH_COOKIE_SECRET?.trim()
  if (!baseUrl || !secret || secret.length < 32) return null
  const key = `${baseUrl}|${secret}`
  // lax, not the default strict: the browser comes back from Google on a cross-site navigation.
  if (cached?.key !== key) cached = { key, auth: createNeonAuth({ baseUrl, cookies: { secret, sameSite: "lax" } }) }
  return cached.auth
}
