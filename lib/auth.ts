import { AppError } from "./errors"
import type { AuthInfo } from "./types"

/**
 * Connecting Google Forms, by hand: authorization code flow with PKCE, and one encrypted cookie for the
 * Google tokens. Who the user is comes from Neon Auth (lib/identity.ts), not from here. Web APIs only
 * (fetch, crypto.subtle, Request/Response), so route handlers and tests need no Next request scope.
 */

export const FORMS_COOKIE = "bb_forms"
export const OAUTH_COOKIE = "bb_oauth"
/** Read-only access to the questions of forms the signed-in user owns or can edit. */
export const FORMS_SCOPE = "https://www.googleapis.com/auth/forms.body.readonly"
export const FORMS_SECS = 30 * 24 * 3600
export const OAUTH_SECS = 10 * 60

type Env = Record<string, string | undefined>

export interface FormsConfig {
  clientId: string
  clientSecret: string
  secret: string
}

/** Null until all three are set, so a half-configured server never offers a broken Connect button. */
export function formsConfig(env: Env = process.env): FormsConfig | null {
  // AUTH_GOOGLE_* is the Auth.js naming, accepted too.
  const clientId = (env.GOOGLE_CLIENT_ID || env.AUTH_GOOGLE_ID)?.trim()
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || env.AUTH_GOOGLE_SECRET)?.trim()
  const secret = env.AUTH_SECRET?.trim()
  return clientId && clientSecret && secret && secret.length >= 32 ? { clientId, clientSecret, secret } : null
}

// ---------- Encoding and sealing ----------

const enc = new TextEncoder()
const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))

export const randomToken = (bytes = 32) => b64(crypto.getRandomValues(new Uint8Array(bytes)))

/** One key per purpose, so a cookie sealed for one job cannot be replayed for another. */
async function sealKey(secret: string, purpose: string) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`${purpose}:${secret}`))
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"])
}

/** Encrypt and authenticate a payload (AES-GCM) with an expiry. The result is safe to put in a cookie. */
export async function seal(payload: object, secret: string, purpose: string, ttlSecs: number, now = Date.now()) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const body = enc.encode(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSecs }))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(purpose) },
      await sealKey(secret, purpose),
      body
    )
  )
  return b64(new Uint8Array([...iv, ...cipher]))
}

/** The payload, or null when the value is missing, forged, for another purpose, or expired. */
export async function unseal<T extends object>(
  token: string | undefined,
  secret: string,
  purpose: string,
  now = Date.now()
): Promise<T | null> {
  if (!token) return null
  try {
    const raw = unb64(token)
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(purpose) },
      await sealKey(secret, purpose),
      raw.slice(12)
    )
    const data = JSON.parse(new TextDecoder().decode(plain)) as T & { exp?: number }
    return typeof data.exp === "number" && data.exp * 1000 > now ? data : null
  } catch {
    return null
  }
}

// ---------- Cookies ----------

export function readCookie(req: Request, name: string): string | undefined {
  const hit = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))
  return hit?.slice(name.length + 1)
}

export const isSecure = (req: Request) => new URL(req.url).protocol === "https:"

export function setCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`
}

export const clearCookie = (name: string, secure: boolean) => setCookie(name, "", 0, secure)

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

/** Back to the home page, with a short reason the page turns into a message. */
export function redirectHome(reason: string, cookies: string[] = []): Response {
  const headers = new Headers({ location: `/?auth=${reason}` })
  for (const c of cookies) headers.append("set-cookie", c)
  return new Response(null, { status: 302, headers })
}

// ---------- The Forms grant ----------

export interface GoogleTokens {
  access: string
  /** Epoch milliseconds. */
  expiresAt: number
  refresh?: string
}

interface FormsGrant {
  /** The Neon Auth user this belongs to. A grant is only honoured for that user. */
  uid: string
  g: GoogleTokens
}

/** The user's Google tokens, if they connected Forms and this cookie is theirs. */
export async function getForms(req: Request, cfg: FormsConfig, uid: string): Promise<GoogleTokens | null> {
  const grant = await unseal<FormsGrant>(readCookie(req, FORMS_COOKIE), cfg.secret, "forms")
  return grant?.uid === uid ? grant.g : null
}

export async function formsCookie(uid: string, g: GoogleTokens, cfg: FormsConfig, secure: boolean) {
  return setCookie(FORMS_COOKIE, await seal({ uid, g }, cfg.secret, "forms", FORMS_SECS), FORMS_SECS, secure)
}

/** What the browser may know. Never the tokens. */
export function authInfo(
  user: { name: string; email: string; image?: string } | null,
  o: { configured: boolean; formsAvailable: boolean; sync: boolean; forms: boolean }
): AuthInfo {
  return {
    configured: o.configured,
    formsAvailable: o.configured && o.formsAvailable,
    sync: o.configured && o.sync,
    user: user ? { name: user.name, email: user.email, picture: user.image } : null,
    forms: Boolean(user) && o.forms,
  }
}

// ---------- Google OAuth (Forms only) ----------

export interface OAuthState {
  state: string
  verifier: string
}

export const newOAuthState = (): OAuthState => ({ state: randomToken(), verifier: randomToken(48) })

export async function codeChallenge(verifier: string) {
  return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))))
}

/** Where Google sends the user back. APP_URL pins it behind a proxy; it must match the console exactly. */
export function redirectUri(req: Request, env: Env = process.env): string {
  const base = env.APP_URL?.trim() || new URL(req.url).origin
  return `${base.replace(/\/+$/, "")}/api/forms/callback`
}

export function authUrl(cfg: FormsConfig, redirect: string, st: OAuthState, challenge: string, loginHint?: string) {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: FORMS_SCOPE,
    state: st.state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // A refresh token is only handed out with consent, and we need one to read forms after the first hour.
    access_type: "offline",
    prompt: "consent",
  })
  if (loginHint) q.set("login_hint", loginHint)
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
}

async function tokenCall(cfg: FormsConfig, params: Record<string, string>): Promise<TokenResponse> {
  let res: Response
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new AppError("AUTH_FAILED", 502, "Couldn't reach Google. Try again.")
  }
  // The body can echo the request, so only the status goes into the error.
  if (!res.ok) throw new AppError("AUTH_FAILED", 502, `Google refused the connection (${res.status}).`)
  const body = (await res.json().catch(() => null)) as TokenResponse | null
  if (!body?.access_token) throw new AppError("AUTH_FAILED", 502, "Google sent an unexpected answer.")
  return body
}

export const exchangeCode = (cfg: FormsConfig, code: string, verifier: string, redirect: string) =>
  tokenCall(cfg, { code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect })

const refreshAccess = (cfg: FormsConfig, refresh: string) =>
  tokenCall(cfg, { refresh_token: refresh, grant_type: "refresh_token" })

export function tokensFrom(t: TokenResponse, now = Date.now(), refresh?: string): GoogleTokens {
  return { access: t.access_token, expiresAt: now + t.expires_in * 1000, refresh: t.refresh_token ?? refresh }
}

export const grantedForms = (t: TokenResponse) => Boolean(t.scope?.split(" ").includes(FORMS_SCOPE))

/**
 * A Forms access token that works now, refreshed when it is about to expire. `tokens` is set when the
 * cookie has to be rewritten. Null when there is nothing to refresh with or Google refused.
 */
export async function formsAccess(
  cfg: FormsConfig,
  g: GoogleTokens,
  now = Date.now()
): Promise<{ token: string; tokens?: GoogleTokens } | null> {
  if (g.expiresAt - 60_000 > now) return { token: g.access }
  if (!g.refresh) return null
  try {
    const next = tokensFrom(await refreshAccess(cfg, g.refresh), now, g.refresh)
    return { token: next.access, tokens: next }
  } catch {
    return null
  }
}
