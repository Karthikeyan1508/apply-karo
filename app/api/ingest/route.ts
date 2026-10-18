import { z } from "zod"
import { newId } from "@/lib/core"
import { demoSession, merchantSession } from "@/lib/demo"
import { formsAccess, formsConfig, formsCookie, getForms, isSecure } from "@/lib/auth"
import { AppError, errorResponse } from "@/lib/errors"
import { fetchFormViaApi, formIdFromUrl } from "@/lib/forms-api"
import { currentUser } from "@/lib/identity"
import { PageForm } from "@/lib/page-form"
import { parseCapture, parseFormUrl, parseGoogleForm } from "@/lib/gforms"
import { buildIntentGraph, llmConfigured, structureFromText } from "@/lib/llm"
import type { Session } from "@/lib/types"

const Body = z.object({
  source: z.enum(["google", "text", "demo", "page"]),
  page: PageForm.optional(),
  demo: z.enum(["job", "merchant"]).default("job"),
  url: z.string().max(2000).optional(),
  text: z.string().max(400_000).optional(),
  context: z.string().max(8000).default(""),
  lang: z.enum(["en-IN", "hi-IN"]).default("en-IN"),
})

const MAX_HTML = 3_000_000
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
  "accept-language": "en",
}

/** Follow redirects by hand so every hop stays on an allowed Google Forms host. */
async function fetchFormHtml(start: URL): Promise<{ html: string; finalUrl: URL }> {
  let url = start
  for (let hop = 0; hop < 4; hop++) {
    let res: Response
    try {
      res = await fetch(url, {
        headers: HEADERS,
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      })
    } catch {
      throw new AppError("FETCH_FAILED", 502, "Couldn't reach Google Forms. Check your connection and the link.")
    }
    if (res.status >= 300 && res.status < 400) {
      const next = parseFormUrl(new URL(res.headers.get("location") ?? "", url).toString())
      if (!next) {
        throw new AppError(
          "FORM_PRIVATE",
          422,
          "This form needs a Google sign-in. Make it public (anyone with the link), or use Paste questions."
        )
      }
      url = next
      continue
    }
    // A restricted form can answer 401 or 403 outright instead of redirecting to a sign-in page.
    if (res.status === 401 || res.status === 403) {
      throw new AppError(
        "FORM_PRIVATE",
        422,
        "This form needs a Google sign-in. Make it public (anyone with the link), or use Paste questions."
      )
    }
    if (res.status === 404) {
      throw new AppError("FETCH_FAILED", 404, "Google Forms couldn't find that form. Check the link.")
    }
    if (!res.ok) {
      throw new AppError("FETCH_FAILED", 502, `Google Forms answered ${res.status}. Check the link.`)
    }
    const html = await res.text()
    if (html.length > MAX_HTML) {
      throw new AppError("PARSE_FAILED", 422, "That page is too large to be a form.")
    }
    return { html, finalUrl: url }
  }
  throw new AppError("FETCH_FAILED", 502, "Too many redirects.")
}

/**
 * A private form, read with the signed-in user's Google Forms access. Null when the user has not
 * connected Forms, so the caller can ask them to. Throws when they have but Google says no.
 */
async function readWithGoogleAccount(req: Request, link: URL) {
  const cfg = formsConfig()
  const user = cfg && (await currentUser())
  const grant = cfg && user ? await getForms(req, cfg, user.id) : null
  if (!cfg || !user || !grant) return null
  const formId = formIdFromUrl(link)
  if (!formId) {
    throw new AppError(
      "FORM_NEEDS_EDIT_LINK",
      422,
      "Google only opens a form you can edit through your account. For a form you only fill in, use the Paste tab and copy its questions from your own browser with the snippet there."
    )
  }
  const access = await formsAccess(cfg, grant)
  if (!access) throw new AppError("AUTH_EXPIRED", 401, "Your Google connection expired. Connect Google Forms again.")
  const form = await fetchFormViaApi(formId, access.token)
  return { form, cookie: access.tokens ? await formsCookie(user.id, access.tokens, cfg, isSecure(req)) : undefined }
}

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", 400, "The request was not in the expected shape.")
    }
    const { source, demo, url, text, context, lang, page } = parsed.data

    if (source === "demo") {
      const base = demo === "merchant" ? merchantSession() : demoSession(lang)
      return Response.json({ session: { ...base, context } satisfies Session })
    }

    // A form the browser extension read off the open page. Its `ref` rides in entryId so the
    // approved answers can be typed back into the same controls.
    if (source === "page") {
      if (!page) throw new AppError("BAD_REQUEST", 400, "No form was sent.")
      if (!llmConfigured()) {
        throw new AppError("LLM_NOT_CONFIGURED", 503, "No Groq key found. Add GROQ_API_KEY to .env.local, or try the demo form.")
      }
      const form = {
        title: page.title.trim() || "Web form",
        description: "",
        fields: page.fields.map((f, index) => ({ index, entryId: f.ref, label: f.label, kind: f.kind, options: f.options, multi: f.multi, required: f.required })),
      }
      const session: Session = {
        id: newId("s"),
        title: form.title,
        description: "",
        source: "page",
        formUrl: page.url ?? null,
        context,
        lang,
        fields: await buildIntentGraph(form, context, lang),
      }
      return Response.json({ session })
    }

    if (source === "text") {
      if (!text || text.trim().length < 10) {
        throw new AppError("BAD_REQUEST", 400, "Paste the form's questions first.")
      }
      // Questions copied out of the person's own browser from a private Google Form.
      const captured = parseCapture(text)
      if (captured) {
        if (!llmConfigured()) {
          throw new AppError("LLM_NOT_CONFIGURED", 503, "No Groq key found. Add GROQ_API_KEY to .env.local, or try the demo form.")
        }
        const session: Session = {
          id: newId("s"),
          title: captured.form.title,
          description: captured.form.description,
          source: "google",
          formUrl: captured.url?.toString() ?? null,
          context,
          lang,
          fields: await buildIntentGraph(captured.form, context, lang),
        }
        return Response.json({ session })
      }
      if (text.length > 20000) throw new AppError("BAD_REQUEST", 400, "That text is too long. Paste the questions only.")
      const { title, fields } = await structureFromText(text, context, lang)
      if (!fields.length) {
        throw new AppError("PARSE_FAILED", 422, "Couldn't find any questions in that text.")
      }
      const session: Session = {
        id: newId("s"),
        title,
        description: "",
        source: "text",
        formUrl: null,
        context,
        lang,
        fields,
      }
      return Response.json({ session })
    }

    const link = parseFormUrl(url ?? "")
    if (!link) {
      throw new AppError(
        "BAD_URL",
        400,
        "Paste a Google Forms link (docs.google.com/forms/... or forms.gle/...)."
      )
    }
    if (!llmConfigured()) {
      throw new AppError(
        "LLM_NOT_CONFIGURED",
        503,
        "No Groq key found. Add GROQ_API_KEY to .env.local, or try the demo form."
      )
    }
    let form
    let formUrl = link.toString()
    let cookie: string | undefined
    try {
      const page = await fetchFormHtml(link)
      form = parseGoogleForm(page.html)
      formUrl = page.finalUrl.toString()
    } catch (e) {
      if (!(e instanceof AppError) || e.code !== "FORM_PRIVATE") throw e
      const viaGoogle = await readWithGoogleAccount(req, link)
      if (!viaGoogle) {
        throw formsConfig() && (await currentUser())
          ? new AppError(
              "FORM_PRIVATE",
              422,
              "This form is private. Connect your Google account to read it (forms you own or can edit), make it public, or use Paste questions."
            )
          : e
      }
      form = viaGoogle.form
      formUrl = viaGoogle.form.responderUri ?? formUrl
      cookie = viaGoogle.cookie
    }
    if (!form) {
      throw new AppError(
        "PARSE_FAILED",
        422,
        "Couldn't read this form's questions. Use Paste questions instead."
      )
    }
    const session: Session = {
      id: newId("s"),
      title: form.title,
      description: form.description,
      source: "google",
      formUrl,
      context,
      lang,
      fields: await buildIntentGraph(form, context, lang),
    }
    return Response.json({ session }, cookie ? { headers: { "set-cookie": cookie } } : undefined)
  } catch (e) {
    return errorResponse(e)
  }
}
