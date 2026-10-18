import type { RawFact, SourceText } from "./profile-ground"

/**
 * Facts that need no model: the person's contact details and links have a fixed shape, so they are found
 * by pattern. Each quote is the exact text matched, so these pass the same quote check as everything else,
 * and the model is left for what only reading can find. Pure, so it is tested.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
const LINKEDIN = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+/i
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?![A-Za-z0-9-])/i
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{4,6}/g
const NOT_A_NAME =
  /resume|curriculum|vitae|\bcv\b|profile|contact|summary|objective|portfolio|linkedin|github|page \d|top skills|skills|languages|certifications|honors|education|experience|projects|technologies/i

const withScheme = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url.replace(/^www\./i, "www.")}`)

/** The first plausible phone number: 10 to 13 digits, so a year or a pincode is not taken for one. */
function phoneIn(text: string): string | null {
  for (const m of text.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, "")
    if (digits.length >= 10 && digits.length <= 13) return m[0].trim()
  }
  return null
}

/** A name from the top of a resume: two to four capitalised words and nothing else on the line. */
function nameIn(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12)
  for (const l of lines) {
    if (l.length > 50 || /[\d@:/|]/.test(l) || NOT_A_NAME.test(l)) continue
    const words = l.split(/\s+/)
    if (words.length < 2 || words.length > 4) continue
    if (words.every((w) => /^[A-Z][A-Za-z.'-]*$/.test(w) || /^[A-Z.]+$/.test(w))) return l
  }
  return null
}

/** A labelled line such as "Name: Asha Patil" or "Location: Pune, India". */
const labelled = (text: string, label: RegExp): string | null => {
  const m = text.match(new RegExp(`^\\s*(?:${label.source})\\s*[:\\-]\\s*(.{2,80})$`, "im"))
  return m ? m[0].trim() : null
}

export function patternFacts(sources: readonly SourceText[]): RawFact[] {
  const out: RawFact[] = []
  const seen = new Set<string>()
  const add = (key: string, label: string, value: string, quote: string, source: string) => {
    if (seen.has(key) || !value.trim()) return
    seen.add(key)
    out.push({ key, label, value: value.trim(), quote, source })
  }

  for (const s of sources) {
    const t = s.text
    const email = t.match(EMAIL)?.[0]
    if (email) add("email", "Email", email, email, s.name)

    const phone = phoneIn(t)
    if (phone) add("phone", "Phone number", phone, phone, s.name)

    const li = t.match(LINKEDIN)?.[0]
    if (li) add("linkedin", "LinkedIn", withScheme(li), li, s.name)

    const gh = t.match(GITHUB)
    if (gh) add("github", "GitHub", `https://github.com/${gh[1]}`, gh[0], s.name)

    const named = labelled(t, /name/)
    if (named) add("full_name", "Full name", named.replace(/^[^:\-]+[:\-]\s*/, ""), named, s.name)
    else {
      const top = nameIn(t)
      if (top) add("full_name", "Full name", top, top, s.name)
    }

    const where = labelled(t, /location|city|address|based in|current location/)
    if (where) add("city", "City", where.replace(/^[^:\-]+[:\-]\s*/, ""), where, s.name)
  }
  return out
}
