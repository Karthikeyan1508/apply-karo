import { AppError } from "./errors"

/**
 * GitHub's device flow, for connecting an account without a redirect address or a client secret, so it
 * works the same on the website and inside the extension's side panel. The person opens github.com/login/device,
 * types a short code, and approves. The token goes straight back to their browser and is never stored here.
 */

/** Read access to private repositories needs `repo`. It is the narrowest OAuth-app scope that includes them. */
export const GITHUB_SCOPE = "repo read:user"

export interface DeviceStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type DevicePoll =
  | { status: "pending" | "slow_down" | "expired" | "denied" }
  | { status: "ok"; token: string; scope: string }

export const githubClientId = (env: Record<string, string | undefined> = process.env) =>
  env.GITHUB_CLIENT_ID?.trim() || null

async function post(url: string, params: Record<string, string>, f: typeof fetch) {
  let res: Response
  try {
    res = await f(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new AppError("GITHUB_UNREACHABLE", 502, "Couldn't reach GitHub. Try again.")
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !body) throw new AppError("GITHUB_FAILED", 502, `GitHub answered ${res.status}.`)
  return body
}

export async function deviceStart(clientId: string, f: typeof fetch = fetch): Promise<DeviceStart> {
  const b = await post("https://github.com/login/device/code", { client_id: clientId, scope: GITHUB_SCOPE }, f)
  if (typeof b.device_code !== "string" || typeof b.user_code !== "string") {
    // GitHub says why in `error`; the usual cause is Device Flow not switched on for the OAuth app.
    const why = typeof b.error_description === "string" ? ` (${b.error_description})` : ""
    throw new AppError("GITHUB_FAILED", 502, `GitHub did not start the connection${why}.`)
  }
  return {
    deviceCode: b.device_code,
    userCode: b.user_code,
    verificationUri: typeof b.verification_uri === "string" ? b.verification_uri : "https://github.com/login/device",
    expiresIn: Number(b.expires_in) || 900,
    interval: Math.max(5, Number(b.interval) || 5),
  }
}

export async function devicePoll(clientId: string, deviceCode: string, f: typeof fetch = fetch): Promise<DevicePoll> {
  const b = await post(
    "https://github.com/login/oauth/access_token",
    { client_id: clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
    f
  )
  if (typeof b.access_token === "string") {
    return { status: "ok", token: b.access_token, scope: typeof b.scope === "string" ? b.scope : "" }
  }
  switch (b.error) {
    case "authorization_pending":
      return { status: "pending" }
    case "slow_down":
      return { status: "slow_down" }
    case "expired_token":
      return { status: "expired" }
    case "access_denied":
      return { status: "denied" }
    default:
      throw new AppError("GITHUB_FAILED", 502, "GitHub refused the connection.")
  }
}
