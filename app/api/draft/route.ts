import { z } from "zod"
import { draftFromValues } from "@/lib/core"
import { AppError, errorResponse } from "@/lib/errors"
import { draftAnswer, llmConfigured } from "@/lib/llm"

const Body = z.object({
  field: z.object({
    label: z.string().max(400),
    intent: z.string().max(400).default(""),
    kind: z.enum(["text", "long_text", "choice"]),
    options: z.array(z.string().max(300)).max(50).default([]),
    multi: z.boolean().default(false),
    maxChars: z.number().int().positive().nullable().default(null),
  }),
  facts: z
    .array(z.object({ slot: z.string().max(60), value: z.string().max(1000) }))
    .min(1)
    .max(12),
  style: z.string().max(600).optional(),
  current: z.string().max(4000).optional(),
})

/** Draft one answer from the facts the user gave. Without a Groq key, returns a plain join of the facts. */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", 400, "The request was not in the expected shape.")
    }
    const { field, facts, style, current } = parsed.data
    if (!llmConfigured()) {
      return Response.json({
        draft: draftFromValues(field, facts.map((f) => f.value)),
        source: "fallback",
      })
    }
    const draft = await draftAnswer({ field, facts, style, current })
    return Response.json({ draft, source: "llm" })
  } catch (e) {
    return errorResponse(e)
  }
}
