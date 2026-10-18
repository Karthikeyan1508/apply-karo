import { z } from "zod"
import { errorResponse, AppError } from "@/lib/errors"
import { llmConfigured, matchSavedFacts } from "@/lib/llm"

const Body = z.object({
  slots: z
    .array(
      z.object({
        field: z.string().max(40),
        slot: z.string().max(60),
        ask: z.string().max(200),
        question: z.string().max(400),
      })
    )
    .max(200),
  saved: z
    .array(
      z.object({
        i: z.number().int().min(0),
        question: z.string().max(400),
        slot: z.string().max(60),
        value: z.string().max(1000),
      })
    )
    .max(300),
})

/** Match saved facts to the slots the free exact match missed. Returns no matches without a Groq key. */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", 400, "The request was not in the expected shape.")
    }
    const { slots, saved } = parsed.data
    if (!llmConfigured() || !slots.length || !saved.length) {
      return Response.json({ fills: [] })
    }
    const fills = await matchSavedFacts({ slots, saved })
    return Response.json({ fills })
  } catch (e) {
    return errorResponse(e)
  }
}
