import { clearCookie, FORMS_COOKIE, isSecure, sameOrigin } from "@/lib/auth"
import { AppError, errorResponse } from "@/lib/errors"

/** Forget the Forms connection on this device. Access already granted can be removed in the Google account. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) throw new AppError("FORBIDDEN", 403, "That request did not come from this site.")
    return new Response(null, { status: 204, headers: { "set-cookie": clearCookie(FORMS_COOKIE, isSecure(req)) } })
  } catch (e) {
    return errorResponse(e)
  }
}
