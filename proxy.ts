import { neonAuth } from "@/lib/auth/server"

// Neon Auth finishes a Google sign-in on the way back: the address carries a one-time verifier that
// this swaps for a session cookie, then it redirects to the clean address. Only that return trip
// runs it, so the rest of the site stays open to everyone.
const auth = neonAuth()

export default auth?.middleware({ loginUrl: "/auth/sign-in" }) ?? (() => undefined)

export const config = {
  matcher: [{ source: "/", has: [{ type: "query", key: "neon_auth_session_verifier" }] }],
}
