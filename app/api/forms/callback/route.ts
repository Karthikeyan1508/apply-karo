import {
  clearCookie,
  exchangeCode,
  formsConfig,
  formsCookie,
  grantedForms,
  isSecure,
  OAUTH_COOKIE,
  readCookie,
  redirectHome,
  redirectUri,
  tokensFrom,
  unseal,
  type OAuthState,
} from "@/lib/auth"
import { currentUser } from "@/lib/identity"

/** Google sends the user back here with a one-time code. Trade it for Forms access and keep it in a sealed cookie. */
export async function GET(req: Request) {
  const cfg = formsConfig()
  if (!cfg) return redirectHome("forms_not_configured")

  const secure = isSecure(req)
  const done = clearCookie(OAUTH_COOKIE, secure)
  const q = new URL(req.url).searchParams
  if (q.get("error")) return redirectHome(q.get("error") === "access_denied" ? "denied" : "error", [done])

  // The state ties this return trip to the connection this browser started.
  const saved = await unseal<OAuthState>(readCookie(req, OAUTH_COOKIE), cfg.secret, "oauth")
  const code = q.get("code")
  const user = await currentUser()
  if (!saved || !code || q.get("state") !== saved.state) return redirectHome("error", [done])
  if (!user) return redirectHome("signin_required", [done])

  try {
    const tokens = await exchangeCode(cfg, code, saved.verifier, redirectUri(req))
    if (!grantedForms(tokens)) return redirectHome("denied", [done])
    return redirectHome("forms", [done, await formsCookie(user.id, tokensFrom(tokens), cfg, secure)])
  } catch {
    return redirectHome("error", [done])
  }
}
