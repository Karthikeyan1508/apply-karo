import { z } from "zod"
import { sameOrigin } from "@/lib/auth"
import { AppError, errorResponse } from "@/lib/errors"
import { devicePoll, githubClientId } from "@/lib/github-device"

const Body = z.object({ deviceCode: z.string().min(10).max(200) })

/** Ask GitHub whether the person has approved yet. The token, once approved, is returned once and not kept. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) throw new AppError("FORBIDDEN", 403, "That request did not come from this site.")
    const id = githubClientId()
    if (!id) throw new AppError("GITHUB_NOT_CONFIGURED", 503, "Connecting GitHub needs GITHUB_CLIENT_ID in .env.local. See Setup.")
    const body = Body.safeParse(await req.json().catch(() => null))
    if (!body.success) throw new AppError("BAD_REQUEST", 400, "The request was not in the expected shape.")
    return Response.json(await devicePoll(id, body.data.deviceCode), { headers: { "cache-control": "no-store" } })
  } catch (e) {
    return errorResponse(e)
  }
}
