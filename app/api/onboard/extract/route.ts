import { z } from "zod"
import { AppError, errorResponse } from "@/lib/errors"
import { llmConfigured } from "@/lib/llm"
import { extractProfile } from "@/lib/profile-extract"

const Body = z.object({
  sources: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        text: z.string().min(20).max(60_000),
      })
    )
    .min(1)
    .max(4),
})

/**
 * Facts from the person's own sources. Every fact returned has a quote that was checked against the
 * source text here. Nothing is stored on the server.
 */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success)
      throw new AppError(
        "BAD_REQUEST",
        400,
        "The request was not in the expected shape."
      )
    if (!llmConfigured()) {
      throw new AppError(
        "LLM_NOT_CONFIGURED",
        503,
        "Reading your sources needs a Groq key. Add GROQ_API_KEY to .env.local, or answer the questions instead."
      )
    }
    const { facts, truncated } = await extractProfile(parsed.data.sources)
    return Response.json({ facts, truncated })
  } catch (e) {
    return errorResponse(e)
  }
}
