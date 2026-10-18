import { authInfo } from "@/lib/auth"
import { neonAuth } from "@/lib/auth/server"
import { currentUser } from "@/lib/identity"
import { profileStore } from "@/lib/profile-store"

/** Who is signed in, and what the server can do for them. Never returns a token. */
export async function GET() {
  const user = await currentUser()
  const info = authInfo(user, {
    configured: Boolean(neonAuth()),
    sync: Boolean(profileStore()),
  })
  return Response.json(info, { headers: { "cache-control": "no-store" } })
}
