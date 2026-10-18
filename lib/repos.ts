/**
 * The person's GitHub repositories as an index, and the pure parts of relating something they say to one
 * of them. Nothing here fetches: the browser reads GitHub with the person's own token (lib/github-client.ts).
 */

export interface Repo {
  name: string
  /** owner/name */
  full: string
  url: string
  description: string
  language: string
  topics: string[]
  stars: number
  /** ISO date of the last push. */
  pushed: string
  private: boolean
  fork: boolean
}

/** GitHub's `/user/repos` list as an index. Anything that is not a repo is dropped. */
export function parseRepos(json: unknown): Repo[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((r: Record<string, unknown>) => {
    if (!r || typeof r.name !== "string" || typeof r.full_name !== "string") return []
    return [
      {
        name: r.name,
        full: r.full_name,
        url: typeof r.html_url === "string" ? r.html_url : `https://github.com/${r.full_name}`,
        description: typeof r.description === "string" ? r.description : "",
        language: typeof r.language === "string" ? r.language : "",
        topics: Array.isArray(r.topics) ? r.topics.filter((t): t is string => typeof t === "string") : [],
        stars: typeof r.stargazers_count === "number" ? r.stargazers_count : 0,
        pushed: typeof r.pushed_at === "string" ? r.pushed_at : "",
        private: Boolean(r.private),
        fork: Boolean(r.fork),
      },
    ]
  })
}

const STOP = new Set(
  "the and for with that this from have has had was were are you your our their built build made make using used use into over about app tool project simple small new one all any can will not but its which what who how why when where also just like very more some than then them they his her she him out get got did does done doing being been".split(
    " "
  )
)

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
const words = (s: string) => squash(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w))

export interface RepoMatch {
  repo: Repo
  /** The repo is named in the text, as opposed to only described. */
  named: boolean
  score: number
}

/**
 * Which repos does this sentence talk about? A repo named outright is a strong match. Otherwise a repo
 * counts when the sentence shares at least two meaningful words with its description and topics. Best first.
 */
export function matchRepos(text: string, repos: readonly Repo[], limit = 3): RepoMatch[] {
  const said = ` ${squash(text)} `
  const saidWords = new Set(words(text))
  if (saidWords.size === 0 && said.trim() === "") return []
  const hits: RepoMatch[] = []
  for (const repo of repos) {
    const name = squash(repo.name)
    // A short name must match whole words; a longer one may be said with or without the separators.
    const compact = name.replace(/ /g, "")
    const named = name.length >= 3 && (said.includes(` ${name} `) || (compact.length >= 6 && said.replace(/ /g, "").includes(compact)))
    const topic = new Set(words(`${repo.description} ${repo.topics.join(" ")} ${repo.name}`))
    const shared = [...saidWords].filter((w) => topic.has(w)).length
    if (named) hits.push({ repo, named: true, score: 100 + shared })
    else if (shared >= 2 && !repo.fork) hits.push({ repo, named: false, score: shared })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** A short list of the person's projects, for the interviewer to recognise when they describe one. */
export function repoDigest(repos: readonly Repo[], max = 30): string {
  const lines = repos
    .filter((r) => !r.fork)
    .slice(0, max)
    .map((r) => {
      const bits = [r.description, r.language].filter(Boolean).join(", ")
      return `- ${r.name}${r.private ? " (private)" : ""}${bits ? `: ${bits}` : ""}`
    })
  return lines.join("\n").slice(0, 3500)
}

/** The page count from a GitHub `Link` header, which is the item count when pages hold one item each. */
export function lastPage(link: string | null): number | null {
  const m = link?.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/)
  return m ? Number(m[1]) : null
}

export interface RepoDetail {
  repo: Repo
  readme: string
  languages: string[]
  /** Commits by the signed-in person, and all commits, when they could be counted. */
  mine: number | null
  total: number | null
  first: string
  last: string
}

/** One plain-text source about a repo. Every line is something an extracted fact may quote. */
export function repoCorpus(d: RepoDetail): string {
  const { repo } = d
  const lines = [`Repository: ${repo.full} (${repo.url})${repo.private ? " [private]" : ""}`]
  if (repo.description) lines.push(`Description: ${repo.description}`)
  if (d.languages.length) lines.push(`Languages: ${d.languages.join(", ")}`)
  if (repo.topics.length) lines.push(`Topics: ${repo.topics.join(", ")}`)
  lines.push(`Stars: ${repo.stars}. Last pushed: ${repo.pushed.slice(0, 10)}`)
  if (d.mine !== null && d.total !== null) {
    lines.push(`Commits by you: ${d.mine} of ${d.total}${d.first ? `. First commit ${d.first}` : ""}${d.last ? `. Latest commit ${d.last}` : ""}`)
  }
  if (d.readme) lines.push("README:", d.readme.slice(0, 3000))
  return lines.join("\n")
}
