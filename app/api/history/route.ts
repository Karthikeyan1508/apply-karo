import { z } from "zod"
import { sameOrigin } from "@/lib/auth"
import { AppError, errorResponse } from "@/lib/errors"
import { guardedHistory, historyStore } from "@/lib/history-store"
import { currentUser } from "@/lib/identity"

const Record = z.object({
  id: z.string().min(1).max(80),
  title: z.string().max(300),
  url: z.string().max(500).nullable(),
  source: z.string().max(20),
  filledAt: z.number(),
  answers: z.array(z.object({ question: z.string().max(500), answer: z.string().max(6000) })).max(200),
})
const Remove = z.union([z.object({ id: z.string().min(1).max(80) }), z.object({ all: z.literal(true) })])

/** The signed-in person's filled forms. Every call needs a session and a configured database. */
async function target() {
  const user = await currentUser()
  if (!user) throw new AppError("NOT_SIGNED_IN", 401, "Sign in to keep your forms in your account.")
  const store = historyStore()
  if (!store) throw new AppError("SYNC_NOT_CONFIGURED", 503, "Keeping forms needs a database. Add DATABASE_URL to .env.local.")
  return { sub: user.id, store }
}

function sameSite(req: Request) {
  if (!sameOrigin(req)) throw new AppError("FORBIDDEN", 403, "That request did not come from this site.")
}

const noStore = { headers: { "cache-control": "no-store" } }

export async function GET() {
  try {
    const { sub, store } = await target()
    return Response.json({ records: await guardedHistory(() => store.list(sub)) }, noStore)
  } catch (e) {
    return errorResponse(e)
  }
}

/** Add or replace one form. */
export async function PUT(req: Request) {
  try {
    sameSite(req)
    const { sub, store } = await target()
    const body = Record.safeParse(await req.json().catch(() => null))
    if (!body.success) throw new AppError("BAD_REQUEST", 400, "The request was not in the expected shape.")
    await guardedHistory(() => store.put(sub, body.data))
    return new Response(null, { status: 204 })
  } catch (e) {
    return errorResponse(e)
  }
}

/** Delete one form (`{"id": ...}`) or all of them (`{"all": true}`). Nothing is deleted without one of those. */
export async function DELETE(req: Request) {
  try {
    sameSite(req)
    const { sub, store } = await target()
    const body = Remove.safeParse(await req.json().catch(() => null))
    if (!body.success) throw new AppError("BAD_REQUEST", 400, "The request was not in the expected shape.")
    await guardedHistory(() => store.remove(sub, "id" in body.data ? body.data.id : undefined))
    return new Response(null, { status: 204 })
  } catch (e) {
    return errorResponse(e)
  }
}
