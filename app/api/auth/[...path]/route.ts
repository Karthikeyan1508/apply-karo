import { neonAuth } from "@/lib/auth/server"

type Ctx = { params: Promise<{ path: string[] }> }

const off = () =>
  Response.json(
    { error: { code: "AUTH_NOT_CONFIGURED", message: "Sign-in needs NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET in .env.local." } },
    { status: 503 }
  )

/** Neon Auth's own API (sign-in, callback, session, sign-out), proxied under /api/auth. */
export const GET = (req: Request, ctx: Ctx) => neonAuth()?.handler().GET(req, ctx) ?? off()
export const POST = (req: Request, ctx: Ctx) => neonAuth()?.handler().POST(req, ctx) ?? off()
