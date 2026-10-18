/**
 * Public GitHub data for onboarding: the profile and the top non-fork repositories with their READMEs,
 * turned into one plain-text source. The only host ever called is api.github.com, and the username is
 * checked against GitHub's own rule before it goes into a URL.
 */

export type GithubErrorCode = "NOT_FOUND" | "RATE_LIMITED" | "FAILED"

export class GithubError extends Error {
  readonly code: GithubErrorCode
  constructor(code: GithubErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export const GITHUB_API = "https://api.github.com"
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const TOP_REPOS = 6
const README_CHARS = 2000
const CORPUS_CHARS = 14_000

/**
 * A GitHub username from a bare name or a github.com profile link, or null. Links on any other host
 * are refused, so a pasted link can never point the server somewhere else.
 */
export function parseGithubUser(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let name = raw
  if (/^https?:\/\//i.test(raw) || /github\.com\//i.test(raw)) {
    let url: URL
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    } catch {
      return null
    }
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null
    const [first] = url.pathname.split("/").filter(Boolean)
    if (!first) return null
    name = first
  }
  return USERNAME.test(name) ? name : null
}

interface GhUser {
  login: string
  name: string | null
  bio: string | null
  company: string | null
  location: string | null
  blog: string | null
  email: string | null
  html_url: string
  public_repos: number
}

interface GhRepo {
  name: string
  full_name: string
  html_url: string
  description: string | null
  fork: boolean
  stargazers_count: number
  pushed_at: string
  language: string | null
  topics?: string[]
}

export interface GithubCorpus {
  login: string
  repos: number
  text: string
}

export interface GithubOptions {
  fetch?: typeof fetch
  /** Optional personal token: raises GitHub's rate limit. Never logged. */
  token?: string
}

async function call(f: typeof fetch, path: string, token: string | undefined, raw = false): Promise<Response> {
  const headers: Record<string, string> = {
    accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
    "user-agent": "Apply करो",
    "x-github-api-version": "2022-11-28",
  }
  if (token) headers.authorization = `Bearer ${token}`
  try {
    return await f(`${GITHUB_API}${path}`, { headers, signal: AbortSignal.timeout(10_000), cache: "no-store" })
  } catch {
    throw new GithubError("FAILED", "Couldn't reach GitHub. Check your connection and try again.")
  }
}

function failed(res: Response, what: string): GithubError {
  if (res.status === 404) return new GithubError("NOT_FOUND", `GitHub has no public profile for ${what}. Check the name.`)
  if (res.status === 403 || res.status === 429) {
    return new GithubError(
      "RATE_LIMITED",
      "GitHub's rate limit was hit. Wait about an hour, or add GITHUB_TOKEN to .env.local, then try again."
    )
  }
  return new GithubError("FAILED", `GitHub answered ${res.status}. Try again later.`)
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw failed(res, what)
  return (await res.json()) as T
}

/** The top non-fork repositories, most starred first, then most recently pushed. */
export function pickRepos(repos: readonly GhRepo[], n = TOP_REPOS): GhRepo[] {
  return repos
    .filter((r) => !r.fork)
    .sort((a, b) => b.stargazers_count - a.stargazers_count || Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .slice(0, n)
}

/** Plain text for the profile and repositories. Every line is a source the model may quote. */
export function corpusText(user: GhUser, repos: readonly { repo: GhRepo; readme: string; languages: string[] }[]): string {
  const lines = [`GitHub profile: ${user.html_url}`]
  const add = (label: string, value: string | null) => value && lines.push(`${label}: ${value}`)
  add("Name", user.name)
  add("Bio", user.bio)
  add("Company", user.company)
  add("Location", user.location)
  add("Website", user.blog)
  add("Public email", user.email)
  lines.push(`Public repositories: ${user.public_repos}`)
  for (const { repo, readme, languages } of repos) {
    lines.push("", `Repository: ${repo.name} (${repo.html_url})`)
    add("Description", repo.description)
    if (languages.length) lines.push(`Languages: ${languages.join(", ")}`)
    if (repo.topics?.length) lines.push(`Topics: ${repo.topics.join(", ")}`)
    lines.push(`Stars: ${repo.stargazers_count}. Last pushed: ${repo.pushed_at.slice(0, 10)}`)
    if (readme) lines.push("README:", readme)
  }
  return lines.join("\n").slice(0, CORPUS_CHARS)
}

/** Read a user's public profile and top repositories. Throws a GithubError the page can show. */
export async function githubCorpus(login: string, opts: GithubOptions = {}): Promise<GithubCorpus> {
  const f = opts.fetch ?? fetch
  const user = await json<GhUser>(await call(f, `/users/${login}`, opts.token), `@${login}`)
  const list = await json<GhRepo[]>(
    await call(f, `/users/${login}/repos?sort=pushed&per_page=100&type=owner`, opts.token),
    `@${login}`
  )
  const top = pickRepos(Array.isArray(list) ? list : [])
  const repos = await Promise.all(
    top.map(async (repo) => {
      const base = `/repos/${repo.full_name.split("/").map(encodeURIComponent).join("/")}`
      const [readme, langs] = await Promise.all([
        call(f, `${base}/readme`, opts.token, true)
          .then((r) => (r.ok ? r.text() : ""))
          .catch(() => ""),
        call(f, `${base}/languages`, opts.token)
          .then((r) => (r.ok ? (r.json() as Promise<Record<string, number>>) : {}))
          .catch(() => ({}) as Record<string, number>),
      ])
      const languages = Object.entries(langs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([name]) => name)
      if (!languages.length && repo.language) languages.push(repo.language)
      return { repo, readme: readme.trim().slice(0, README_CHARS), languages }
    })
  )
  const text = corpusText(user, repos)
  return { login: user.login, repos: repos.length, text }
}
