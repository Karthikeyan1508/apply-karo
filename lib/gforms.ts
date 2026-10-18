import type { FieldKind, RawField } from "./types"

export interface ParsedForm {
  title: string
  description: string
  fields: RawField[]
}

const ALLOWED_HOSTS = new Set(["docs.google.com", "forms.gle", "forms.google.com"])

/** Only fetch Google Forms links. Stops the server being used to fetch arbitrary URLs. */
export function parseFormUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim())
    if (url.protocol !== "https:") return null
    if (!ALLOWED_HOSTS.has(url.hostname)) return null
    if (url.hostname === "docs.google.com" && !url.pathname.startsWith("/forms/")) {
      return null
    }
    return url
  } catch {
    return null
  }
}

/** Pull the `FB_PUBLIC_LOAD_DATA_` array out of a Google Form page. Bracket-matches, so `];` inside strings is safe. */
export function extractLoadData(html: string): unknown[] | null {
  const at = html.indexOf("FB_PUBLIC_LOAD_DATA_")
  if (at < 0) return null
  const start = html.indexOf("[", at)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === "\\") escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === "[") depth++
    else if (c === "]") {
      depth--
      if (depth === 0) {
        try {
          const data: unknown = JSON.parse(html.slice(start, i + 1))
          return Array.isArray(data) ? data : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const TYPES: Record<number, { kind: FieldKind; multi?: boolean }> = {
  0: { kind: "text" }, // short answer
  1: { kind: "long_text" }, // paragraph
  2: { kind: "choice" }, // multiple choice
  3: { kind: "choice" }, // dropdown
  4: { kind: "choice", multi: true }, // checkboxes
  5: { kind: "choice" }, // linear scale
  9: { kind: "text" }, // date
  10: { kind: "text" }, // time
}

const at = (v: unknown, i: number): unknown => (Array.isArray(v) ? v[i] : undefined)

/**
 * Parse a Google Form page into questions.
 *
 * shortcut: relies on Google's undocumented FB_PUBLIC_LOAD_DATA_ layout. It has been
 * stable for years, but if Google changes it, parsing returns null and the app falls
 * back to the "paste questions" path.
 */
export function parseGoogleForm(html: string): ParsedForm | null {
  return parseLoadData(extractLoadData(html))
}

/** The same parse, for the data array itself. */
export function parseLoadData(data: unknown[] | null): ParsedForm | null {
  const root = at(data, 1)
  const items = at(root, 1)
  if (!Array.isArray(items)) return null

  const fields: RawField[] = []
  items.forEach((item, index) => {
    const kind = TYPES[at(item, 3) as number]
    const label = at(item, 1)
    if (!kind || typeof label !== "string" || !label.trim()) return
    const spec = at(at(item, 4), 0)
    const entry = at(spec, 0)
    const rawOptions = at(spec, 1)
    fields.push({
      index,
      entryId: typeof entry === "number" || typeof entry === "string" ? String(entry) : null,
      label: label.trim(),
      kind: kind.kind,
      multi: Boolean(kind.multi),
      options: Array.isArray(rawOptions)
        ? rawOptions.map((o) => at(o, 0)).filter((o): o is string => typeof o === "string" && o !== "")
        : [],
      required: at(spec, 2) === 1,
    })
  })
  if (!fields.length) return null

  const title = at(root, 8) ?? at(data, 3)
  const description = at(root, 0)
  return {
    title: typeof title === "string" && title.trim() ? title.trim() : "Untitled form",
    description: typeof description === "string" ? description.trim() : "",
    fields,
  }
}

/**
 * A form only a signed-in person can open can't be fetched by the server, but the page in their own
 * browser already holds its questions. Running this in the browser console on the open form copies them
 * (`copy` is a console helper). The result is pasted into BolBharo, which never sees a cookie.
 */
export const CAPTURE_SNIPPET =
  'copy(JSON.stringify({bolbharo:"form",url:location.href,data:FB_PUBLIC_LOAD_DATA_}))'

/** The form from pasted CAPTURE_SNIPPET output, or null when the text is something else. */
export function parseCapture(text: string): { form: ParsedForm; url: URL | null } | null {
  if (!text.trimStart().startsWith("{")) return null
  try {
    const c = JSON.parse(text) as { bolbharo?: unknown; url?: unknown; data?: unknown }
    if (c.bolbharo !== "form" || !Array.isArray(c.data)) return null
    const form = parseLoadData(c.data)
    return form ? { form, url: typeof c.url === "string" ? parseFormUrl(c.url) : null } : null
  } catch {
    return null
  }
}
