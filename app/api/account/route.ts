import { authInfo, formsConfig, getForms } from "@/lib/auth"
import { neonAuth } from "@/lib/auth/server"
import { currentUser } from "@/lib/identity"
import { profileStore } from "@/lib/profile-store"

/** Who is signed in, and what the server can do for them. Never returns a token. */
export async function GET(req: Request) {
  const user = await currentUser()
  const forms = formsConfig()
  const info = authInfo(user, {
    configured: Boolean(neonAuth()),
    formsAvailable: Boolean(forms),
    sync: Boolean(profileStore()),
    forms: Boolean(user && forms && (await getForms(req, forms, user.id))),
  })
  return Response.json(info, { headers: { "cache-control": "no-store" } })
}
