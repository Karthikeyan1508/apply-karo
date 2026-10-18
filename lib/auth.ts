import type { AuthInfo } from "./types"

/** A state-changing request must come from this site. SameSite=Lax already blocks most cross-site posts; this closes the rest. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin")
  if (!origin) return false
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** What the browser may know about the signed-in person. Who they are comes from Neon Auth (lib/identity.ts). */
export function authInfo(
  user: { name: string; email: string; image?: string } | null,
  o: { configured: boolean; sync: boolean }
): AuthInfo {
  return {
    configured: o.configured,
    sync: o.configured && o.sync,
    user: user ? { name: user.name, email: user.email, picture: user.image } : null,
  }
}
