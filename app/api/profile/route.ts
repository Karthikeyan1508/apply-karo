import { z } from "zod"
import { sameOrigin } from "@/lib/auth"
import { AppError, errorResponse } from "@/lib/errors"
import { currentUser } from "@/lib/identity"
import { guarded, profileStore } from "@/lib/profile-store"

// The optional fields came with the onboarding profile. Older items, which lack them, still pass.
const Item = z.object({
  label: z.string().max(400),
  slot: z.string().max(60),
  value: z.string().max(2000),
  quote: z.string().max(2000),
  form: z.string().max(300),
  savedAt: z.number(),
  key: z.string().max(80).optional(),
  source: z.string().max(60).optional(),
  confirmed: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  autofill: z.boolean().optional(),
})
const Body = z.object({ items: z.array(Item).max(500) })

/** The signed-in user's synced facts. Every call needs a session and a configured database. */
async function target() {
  const user = await currentUser()
  if (!user) throw new AppError("NOT_SIGNED_IN", 401, "Sign in with Google to sync your saved facts.")
  const store = profileStore()
  if (!store) throw new AppError("SYNC_NOT_CONFIGURED", 503, "Syncing needs a database. Add DATABASE_URL to .env.local.")
  return { sub: user.id, store }
}

function sameSite(req: Request) {
  if (!sameOrigin(req)) throw new AppError("FORBIDDEN", 403, "That request did not come from this site.")
}

const noStore = { headers: { "cache-control": "no-store" } }

export async function GET() {
  try {
    const { sub, store } = await target()
    return Response.json({ items: await guarded(() => store.get(sub)) }, noStore)
  } catch (e) {
    return errorResponse(e)
  }
}

/** Add facts. The server keeps the newest per question, so a stale device cannot wipe a newer fact. */
export async function PUT(req: Request) {
  try {
    sameSite(req)
    const { sub, store } = await target()
    const body = Body.safeParse(await req.json().catch(() => null))
    if (!body.success) throw new AppError("BAD_REQUEST", 400, "The request was not in the expected shape.")
    return Response.json({ items: await guarded(() => store.put(sub, body.data.items)) }, noStore)
  } catch (e) {
    return errorResponse(e)
  }
}

export async function DELETE(req: Request) {
  try {
    sameSite(req)
    const { sub, store } = await target()
    await guarded(() => store.remove(sub))
    return new Response(null, { status: 204 })
  } catch (e) {
    return errorResponse(e)
  }
}
