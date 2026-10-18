import { sameOrigin } from "@/lib/auth"
import { AppError, errorResponse } from "@/lib/errors"
import { deviceStart, githubClientId } from "@/lib/github-device"

/** Start connecting GitHub: returns the short code the person types at github.com/login/device. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) throw new AppError("FORBIDDEN", 403, "That request did not come from this site.")
    const id = githubClientId()
    if (!id) throw new AppError("GITHUB_NOT_CONFIGURED", 503, "Connecting GitHub needs GITHUB_CLIENT_ID in .env.local. See Setup.")
    return Response.json(await deviceStart(id), { headers: { "cache-control": "no-store" } })
  } catch (e) {
    return errorResponse(e)
  }
}
