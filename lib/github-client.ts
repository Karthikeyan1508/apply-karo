import type { PrefillFill } from "./core"
import { prefillMatches } from "./profile"
import { isProjectQuestion, lastPage, matchRepos, parseRepos, repoCorpus, repoDigest, type Repo, type RepoDetail } from "./repos"
import type { ProfileItem, Session } from "./types"

/**
 * The person's own GitHub, read from their browser with their own token. The token and the repo index live
 * in this browser's storage (the side panel keeps its own copy) and only ever go to api.github.com.
 */

const LINK_KEY = "bolbharo.github.v1"
const REPOS_KEY = "bolbharo.repos.v1"
const FACTS_KEY = "bolbharo.repofacts.v1"
export const GITHUB_EVENT = "bolbharo:github"
const API = "https://api.github.com"
const notify = () => window.dispatchEvent(new Event(GITHUB_EVENT))

export interface GithubLink {
  token: string
  login: string
  at: number
}

const read = <T>(key: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null
  } catch {
    return null
  }
}
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked or full: the connection just cannot be remembered
  }
}

export const loadLink = (): GithubLink | null => read<GithubLink>(LINK_KEY)
export const loadRepos = (): Repo[] => read<Repo[]>(REPOS_KEY) ?? []
/** The raw text of the saved connection, for `useSyncExternalStore`. */
export const readLinkRaw = (): string | null => {
  try {
    return localStorage.getItem(LINK_KEY)
  } catch {
    return null
  }
}

export function saveLink(link: GithubLink) {
  write(LINK_KEY, link)
  notify()
}

/** Forget the token, the repo index and what was read from them. Revoking the app on GitHub is the person's step. */
export function clearLink() {
  try {
    for (const k of [LINK_KEY, REPOS_KEY, FACTS_KEY]) localStorage.removeItem(k)
  } catch {
    // nothing was saved
  }
  notify()
}

async function gh(path: string, token: string, raw = false): Promise<Response> {
  return fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
    cache: "no-store",
  })
}

// ---------- Device flow, through this app's two routes ----------

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null
  if (!res.ok || !data || (data as { error?: unknown }).error) {
    throw new Error(data?.error?.message ?? "Couldn't reach the server.")
  }
  return data
}

export const startDevice = () => api<DeviceCode>("/api/github/device")

/** Poll until the person approves, denies, or the code runs out. `cancelled` stops it early. */
export async function waitForApproval(
  code: DeviceCode,
  cancelled: () => boolean,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<{ token: string } | "denied" | "expired" | "cancelled"> {
  let every = code.interval
  const end = Date.now() + code.expiresIn * 1000
  while (Date.now() < end) {
    await sleep(every * 1000)
    if (cancelled()) return "cancelled"
    const r = await api<{ status: string; token?: string }>("/api/github/poll", { deviceCode: code.deviceCode })
    if (r.status === "ok" && r.token) return { token: r.token }
    if (r.status === "denied" || r.status === "expired") return r.status
    if (r.status === "slow_down") every += 5
  }
  return "expired"
}

// ---------- The repo index ----------

/** Read who the token belongs to and every repo it can see (public and private), and keep them. */
export async function connect(token: string): Promise<{ login: string; repos: Repo[] }> {
  const me = await gh("/user", token)
  if (!me.ok) throw new Error(me.status === 401 ? "GitHub did not accept that connection." : `GitHub answered ${me.status}.`)
  const login = ((await me.json()) as { login: string }).login
  const repos: Repo[] = []
  for (let page = 1; page <= 4; page++) {
    const res = await gh(`/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`, token)
    if (!res.ok) throw new Error(`GitHub answered ${res.status} while listing your repositories.`)
    const batch = parseRepos(await res.json())
    repos.push(...batch)
    if (batch.length < 100) break
  }
  saveLink({ token, login, at: Date.now() })
  write(REPOS_KEY, repos)
  notify()
  return { login, repos }
}

/** Re-read the repo list with the saved token. */
export async function refresh() {
  const link = loadLink()
  if (!link) throw new Error("GitHub is not connected.")
  return connect(link.token)
}

const date = (s?: string) => (s ? s.slice(0, 10) : "")

async function commitCount(token: string, repo: Repo, author?: string): Promise<number | null> {
  const q = author ? `&author=${encodeURIComponent(author)}` : ""
  const res = await gh(`/repos/${repo.full}/commits?per_page=1${q}`, token)
  if (!res.ok) return null
  const items = (await res.json().catch(() => [])) as unknown[]
  return lastPage(res.headers.get("link")) ?? items.length
}

/** What GitHub says about one repo: README, languages, and how many commits are the person's own. */
export async function repoDetail(link: GithubLink, repo: Repo): Promise<RepoDetail> {
  const [readme, langs, mine, total, newest] = await Promise.all([
    gh(`/repos/${repo.full}/readme`, link.token, true).then((r) => (r.ok ? r.text() : "")).catch(() => ""),
    gh(`/repos/${repo.full}/languages`, link.token)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, number>>) : {}))
      .catch(() => ({}) as Record<string, number>),
    commitCount(link.token, repo, link.login).catch(() => null),
    commitCount(link.token, repo).catch(() => null),
    gh(`/repos/${repo.full}/commits?per_page=1&author=${encodeURIComponent(link.login)}`, link.token)
      .then(async (r) => (r.ok ? ((await r.json()) as { commit?: { author?: { date?: string } } }[])[0]?.commit?.author?.date : ""))
      .catch(() => ""),
  ])
  const languages = Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n)
  if (!languages.length && repo.language) languages.push(repo.language)
  return { repo, readme: readme.trim(), languages, mine, total, first: "", last: date(newest) }
}

// ---------- Facts about a repo, on demand ----------

type FactCache = Record<string, { at: number; facts: ProfileItem[] }>
const FACT_TTL = 24 * 3600 * 1000

/** Facts the model can quote from one repo's own text. Read once per day per repo, then reused. */
export async function repoFacts(link: GithubLink, repo: Repo, now = Date.now()): Promise<ProfileItem[]> {
  const cache = read<FactCache>(FACTS_KEY) ?? {}
  const hit = cache[repo.full]
  if (hit && now - hit.at < FACT_TTL) return hit.facts
  const text = repoCorpus(await repoDetail(link, repo))
  const { facts } = await api<{ facts: ProfileItem[] }>("/api/onboard/extract", {
    sources: [{ name: `github:${repo.name}`.slice(0, 40), text }],
  })
  // Every fact keeps the repo as its source, so the profile and the review show where it came from.
  const tagged = facts.map((f) => ({ ...f, source: `github:${repo.name}`.slice(0, 60), confirmed: false }))
  write(FACTS_KEY, { ...cache, [repo.full]: { at: now, facts: tagged } })
  return tagged
}

// ---------- Relating what the person says to a repo ----------

export interface Related {
  repo: Repo
  /** Slots the repo's facts can answer. Applied as "to confirm", never as finished answers. */
  fills: PrefillFill[]
}

/**
 * The person mentioned a project. If it is one of their repos, find which of the open questions that
 * repo can answer. Returns a question to ask instead when two repos fit, and null when none do.
 */
export async function relateProject(
  session: Session,
  utterance: string,
  seen: Set<string>
): Promise<{ related: Related } | { ask: string } | null> {
  const link = loadLink()
  if (!link || session.source === "onboarding") return null
  const hits = matchRepos(utterance, loadRepos()).filter((h) => !seen.has(h.repo.full))
  if (!hits.length) return null
  const named = hits.filter((h) => h.named)
  const pick = named.length === 1 ? named[0] : named.length === 0 && hits.length === 1 ? hits[0] : null
  if (!pick) return { ask: `The user may mean one of these repositories: ${hits.map((h) => h.repo.name).join(", ")}. Ask which one they mean.` }
  seen.add(pick.repo.full)
  const facts = await repoFacts(link, pick.repo)
  if (!facts.length) return null
  const fills = await prefillMatches(session, facts)
  return fills.length ? { related: { repo: pick.repo, fills } } : null
}

/** The briefing the interviewer gets once connected: what projects exist, so it can recognise one being described. */
export function briefing(): string | null {
  const link = loadLink()
  const digest = repoDigest(loadRepos())
  if (!link || !digest) return null
  return `The user connected their GitHub (@${link.login}). Their projects, private ones included:\n${digest}\nWhen the user talks about one of these, say its name back to them. Details from that repository are then provided to you: confirm them briefly instead of asking for them again, and ask only for what is still missing.`
}

// ---------- Asking which repos to use for a project question ----------

/**
 * When GitHub is connected and the form asks about the person's projects, mark that question so the chat
 * asks which repos to use. Without a connection, or without such a question, the form is left as it is.
 */
export function withProjectChoice(session: Session): Session {
  if (session.source === "onboarding" || session.source === "demo" || !loadLink() || !loadRepos().length) return session
  const field = session.fields.find((f) => isProjectQuestion(f) && f.slots.some((s) => s.value === null))
  return field ? { ...session, projectChoice: { fieldId: field.id, stage: "ask", repos: [], leftover: [] } } : session
}

/**
 * What the chosen repos answer on the project question. The person picked these repos for this question,
 * so what they say counts as given (not "to confirm"); the model only chooses which slot each fact fills.
 */
export async function projectFills(session: Session, fieldId: string, repos: readonly Repo[]): Promise<PrefillFill[]> {
  const link = loadLink()
  const field = session.fields.find((f) => f.id === fieldId)
  if (!link || !field) return []
  const facts = (await Promise.all(repos.map((r) => repoFacts(link, r).catch(() => [] as ProfileItem[])))).flat()
  if (!facts.length) return []
  const trusted = facts.map((f) => ({ ...f, confirmed: true, sensitive: false }))
  return prefillMatches({ ...session, fields: [field] }, trusted)
}
