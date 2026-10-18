import { AppError } from "./errors"
import type { ParsedForm } from "./gforms"
import type { FieldKind, RawField } from "./types"

/**
 * Read a form through the Google Forms API, with the signed-in user's token. This is how a private
 * form is read. Google only allows it for forms that account owns or can edit.
 */

/** The form id the API wants, from an edit link. Share links (`/d/e/...`) carry a different id. */
export function formIdFromUrl(url: URL): string | null {
  // "e" is 1 character, so the length floor also rules out the published-id form of the path.
  return /^\/forms\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{15,})(?:\/|$)/.exec(url.pathname)?.[1] ?? null
}

interface ApiQuestion {
  questionId?: string
  required?: boolean
  choiceQuestion?: { type?: string; options?: { value?: string }[] }
  textQuestion?: { paragraph?: boolean }
  scaleQuestion?: { low?: number; high?: number }
  dateQuestion?: unknown
  timeQuestion?: unknown
}
interface ApiForm {
  info?: { title?: string; documentTitle?: string; description?: string }
  responderUri?: string
  items?: { title?: string; questionItem?: { question?: ApiQuestion } }[]
}

function kindOf(q: ApiQuestion): { kind: FieldKind; multi: boolean; options: string[] } | null {
  if (q.choiceQuestion) {
    const options = (q.choiceQuestion.options ?? []).map((o) => o.value).filter((v): v is string => !!v)
    return { kind: "choice", multi: q.choiceQuestion.type === "CHECKBOX", options }
  }
  if (q.textQuestion) return { kind: q.textQuestion.paragraph ? "long_text" : "text", multi: false, options: [] }
  if (q.scaleQuestion) {
    const { low = 1, high = 5 } = q.scaleQuestion
    const options = Array.from({ length: Math.max(0, Math.min(high - low + 1, 20)) }, (_, i) => String(low + i))
    return { kind: "choice", multi: false, options }
  }
  if (q.dateQuestion || q.timeQuestion) return { kind: "text", multi: false, options: [] }
  return null // file upload, grids and the like: nothing to interview for
}

/** The Forms API's answer, as the same shape the page parser produces. */
export function parseFormsApi(data: unknown): (ParsedForm & { responderUri: string | null }) | null {
  const form = data as ApiForm | null
  if (!form || typeof form !== "object" || !Array.isArray(form.items)) return null
  const fields: RawField[] = []
  form.items.forEach((item, index) => {
    const q = item.questionItem?.question
    const label = item.title?.trim()
    const spec = q && kindOf(q)
    if (!q || !spec || !label) return
    // The entry.NNN number in a prefilled link is the question id, read as hexadecimal.
    const entry = q.questionId ? parseInt(q.questionId, 16) : NaN
    fields.push({
      index,
      entryId: Number.isFinite(entry) ? String(entry) : null,
      label,
      kind: spec.kind,
      multi: spec.multi,
      options: spec.options,
      required: Boolean(q.required),
    })
  })
  if (!fields.length) return null
  return {
    title: form.info?.title?.trim() || form.info?.documentTitle?.trim() || "Untitled form",
    description: form.info?.description?.trim() ?? "",
    fields,
    responderUri: form.responderUri ?? null,
  }
}

export async function fetchFormViaApi(formId: string, token: string) {
  let res: Response
  try {
    res = await fetch(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    })
  } catch {
    throw new AppError("FETCH_FAILED", 502, "Couldn't reach Google Forms. Check your connection and the link.")
  }
  if (res.status === 401) {
    throw new AppError("AUTH_EXPIRED", 401, "Your Google connection expired. Connect Google Forms again.")
  }
  if (res.status === 403) {
    const said = await res
      .json()
      .then((b: { error?: { message?: string } }) => b.error?.message?.slice(0, 160))
      .catch(() => undefined)
    throw new AppError(
      "FORM_NO_ACCESS",
      403,
      `This Google account can't open that form. Google only lets BolBharo read forms you own or can edit.${said ? ` (${said})` : ""}`
    )
  }
  if (res.status === 404) {
    throw new AppError("FETCH_FAILED", 404, "Google can't find that form. Paste its edit link (it ends in /edit).")
  }
  if (!res.ok) throw new AppError("FETCH_FAILED", 502, `Google Forms answered ${res.status}. Try again.`)
  const form = parseFormsApi(await res.json().catch(() => null))
  if (!form) {
    throw new AppError("PARSE_FAILED", 422, "That form has no questions BolBharo can ask about. Use Paste questions instead.")
  }
  return form
}
