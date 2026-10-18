import { extractText, getDocumentProxy } from "unpdf"
import { z } from "zod"
import { AppError, errorResponse } from "@/lib/errors"
import { extractFromDocument, llmConfigured } from "@/lib/llm"

const MAX_FILE = 5_000_000
const MAX_TEXT = 60_000
const UNREADABLE = "Couldn't read any text in that file. If it is a scanned PDF, paste the text instead."

const Facts = z.object({
  text: z.string().min(20).max(MAX_TEXT),
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
})

async function textOf(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(bytes)
    return (await extractText(pdf, { mergePages: true })).text
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return new TextDecoder().decode(bytes)
  }
  throw new AppError("UNSUPPORTED_FILE", 415, "Upload a PDF or a text file.")
}

/**
 * Two jobs on one route. A file upload comes back as plain text. Text plus the still-open slots comes
 * back as facts, each with a quote from that text. The document is read once and never stored.
 */
export async function POST(req: Request) {
  try {
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const file = (await req.formData()).get("file")
      if (!(file instanceof File)) throw new AppError("BAD_REQUEST", 400, "No file was sent.")
      if (file.size > MAX_FILE) throw new AppError("FILE_TOO_LARGE", 413, "That file is over 5 MB.")
      let text: string
      try {
        text = await textOf(file)
      } catch (e) {
        if (e instanceof AppError) throw e
        throw new AppError("UNREADABLE_FILE", 422, UNREADABLE)
      }
      text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
      if (text.length < 20) throw new AppError("UNREADABLE_FILE", 422, UNREADABLE)
      return Response.json({ text: text.slice(0, MAX_TEXT) })
    }

    const parsed = Facts.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", 400, "The request was not in the expected shape.")
    }
    if (!llmConfigured()) {
      throw new AppError("LLM_NOT_CONFIGURED", 503, "Reading a document needs a Groq key. Add GROQ_API_KEY to .env.local.")
    }
    const { text, slots } = parsed.data
    return Response.json({ fills: slots.length ? await extractFromDocument(text, slots) : [] })
  } catch (e) {
    return errorResponse(e)
  }
}
