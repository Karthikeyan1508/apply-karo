import {
  authUrl,
  codeChallenge,
  formsConfig,
  isSecure,
  newOAuthState,
  OAUTH_COOKIE,
  OAUTH_SECS,
  redirectHome,
  redirectUri,
  seal,
  setCookie,
} from "@/lib/auth"
import { currentUser } from "@/lib/identity"

/** Start connecting Google Forms. Only for someone already signed in. */
export async function GET(req: Request) {
  const cfg = formsConfig()
  if (!cfg) return redirectHome("forms_not_configured")
  const user = await currentUser()
  if (!user) return redirectHome("signin_required")

  const st = newOAuthState()
  const sealed = await seal(st, cfg.secret, "oauth", OAUTH_SECS)
  return new Response(null, {
    status: 302,
    headers: {
      location: authUrl(cfg, redirectUri(req), st, await codeChallenge(st.verifier), user.email),
      "set-cookie": setCookie(OAUTH_COOKIE, sealed, OAUTH_SECS, isSecure(req)),
    },
  })
}
