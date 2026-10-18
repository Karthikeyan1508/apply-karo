import { z } from "zod"
import { AppError, errorResponse } from "@/lib/errors"
import { llmConfigured, readinessCheck } from "@/lib/llm"

const Body = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().max(40),
        label: z.string().max(500),
        kind: z.string().max(20),
        options: z.array(z.string().max(300)).max(80),
        intent: z.string().max(500),
      })
    )
    .min(1)
    .max(100),
  known: z.string().max(8000).default(""),
  notes: z.string().max(4000).default(""),
})

/** Before any answer is filled: which questions are understood, and which have enough to answer. Quiet without a key. */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new AppError("BAD_REQUEST", 400, "The request was not in the expected shape.")
    if (!llmConfigured()) return Response.json({ checks: [] })
    const { questions, known, notes } = parsed.data
    const ids = new Set(questions.map((q) => q.id))
    const checks = (await readinessCheck(questions, known, notes)).filter((c) => ids.has(c.id))
    return Response.json({ checks })
  } catch (e) {
    return errorResponse(e)
  }
}
