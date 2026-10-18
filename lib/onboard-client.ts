import type { Doc } from "./document"
import { groundFacts, type RawFact, type SourceText } from "./profile-ground"
import { validGrillQuestions, type GrillQuestion } from "./profile-grill"
import type { ApiError, ProfileItem } from "./types"

export interface OnboardInputs {
  /** A resume uploaded as a file, or pasted. */
  resume: Doc | null
  /** The LinkedIn profile saved to PDF, or pasted. */
  linkedin: Doc | null
  /** A GitHub username or profile link. */
  github: string
  /** The LinkedIn profile link. Stored as a link only, never opened or scraped. */
  linkedinUrl: string
}

export type ReadStep = "github" | "facts"

export interface ReadResult {
  facts: ProfileItem[]
  /** Problems that do not stop the read, such as a GitHub user that was not found. Shown to the person. */
  notes: string[]
}

/** Build at most six source-aware questions from reviewed compact facts. */
export async function readGrill(
  facts: readonly ProfileItem[]
): Promise<GrillQuestion[]> {
  const compact = facts
    .filter((f) => /^(project|experience):/.test(f.key ?? ""))
    .slice(0, 24)
    .map(({ key, label, value, source }) => ({
      key: key ?? "",
      label,
      value,
      source,
    }))
  if (!compact.length) return []
  const res = await post<{ questions: GrillQuestion[] }>("/api/onboard/grill", {
    facts: compact,
  })
  return validGrillQuestions(res.questions, facts)
}

const shortName = (name: string) =>
  name
    .replace(/[^\w .()-]/g, "")
    .trim()
    .slice(0, 40) || "resume"

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as T | ApiError | null
  if (!res.ok || !data || (typeof data === "object" && "error" in data)) {
    throw new Error(
      data && typeof data === "object" && "error" in data
        ? data.error.message
        : "Something went wrong."
    )
  }
  return data as T
}

/** A LinkedIn link on linkedin.com, or null. Anything else is refused rather than stored. */
export function linkedinLink(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return url.hostname === "linkedin.com" ||
      url.hostname.endsWith(".linkedin.com")
      ? url.toString().replace(/\/$/, "")
      : null
  } catch {
    return null
  }
}

/**
 * Read every source the person gave. The model reads the documents (resume, GitHub, LinkedIn text)
 * together. Links are facts too, with the link itself as the quote. Every fact is checked against its
 * source again here, so the browser never trusts the server alone.
 */
export async function readSources(
  inputs: OnboardInputs,
  onStep: (step: ReadStep) => void,
  now = Date.now()
): Promise<ReadResult> {
  const notes: string[] = []
  // Every source a quote may come from.
  const sources: SourceText[] = []
  // Only the documents go to the model.
  const modelSources: SourceText[] = []
  const links: RawFact[] = []

  if (inputs.resume) {
    const resume = {
      name: shortName(inputs.resume.name),
      text: inputs.resume.text,
    }
    sources.push(resume)
    modelSources.push(resume)
  }

  if (inputs.github.trim()) {
    onStep("github")
    try {
      const gh = await post<{ source: SourceText; login: string }>(
        "/api/onboard/github",
        { input: inputs.github }
      )
      sources.push(gh.source)
      modelSources.push(gh.source)
      const url = `https://github.com/${gh.login}`
      links.push({
        key: "github",
        label: "GitHub",
        value: url,
        quote: url,
        source: "github",
      })
    } catch (e) {
      notes.push(
        `GitHub: ${e instanceof Error ? e.message : "couldn't read it."}`
      )
    }
  }

  const link = inputs.linkedinUrl.trim()
    ? linkedinLink(inputs.linkedinUrl)
    : null
  if (inputs.linkedinUrl.trim() && !link)
    notes.push(
      "LinkedIn: that is not a linkedin.com link, so it was not saved."
    )
  if (link) {
    links.push({
      key: "linkedin",
      label: "LinkedIn",
      value: link,
      quote: link,
      source: "linkedin",
    })
    sources.push({ name: "linkedin", text: `LinkedIn profile: ${link}` })
  }
  if (inputs.linkedin) {
    const text =
      (link ? `LinkedIn profile: ${link}\n` : "") + inputs.linkedin.text
    sources.push({ name: "linkedin", text })
    modelSources.push({ name: "linkedin", text })
  }

  let extracted: RawFact[] = []
  if (modelSources.length) {
    onStep("facts")
    const res = await post<{ facts: ProfileItem[]; truncated: boolean }>(
      "/api/onboard/extract",
      { sources: modelSources }
    )
    extracted = res.facts.map((f) => ({
      key: f.key ?? "",
      label: f.label,
      value: f.value,
      quote: f.quote,
      source: f.source ?? "",
    }))
    if (res.truncated)
      notes.push("Your documents are long. Only the first part was read.")
  }

  // Links first, so a link wins over anything the model said about the same key.
  const facts = groundFacts([...links, ...extracted], sources, now)
  return { facts, notes }
}
