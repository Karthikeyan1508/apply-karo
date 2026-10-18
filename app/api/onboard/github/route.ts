import { z } from "zod"
import { AppError, errorResponse } from "@/lib/errors"
import { githubCorpus, GithubError, parseGithubUser } from "@/lib/github"

const Body = z.object({ input: z.string().max(300) })

const STATUS = { NOT_FOUND: 404, RATE_LIMITED: 429, FAILED: 502 } as const

/**
 * Public GitHub data for the onboarding profile, as one labelled source. Only api.github.com is called.
 * GITHUB_TOKEN is optional and only raises GitHub's rate limit; it is never sent back.
 */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new AppError("BAD_REQUEST", 400, "The request was not in the expected shape.")
    const login = parseGithubUser(parsed.data.input)
    if (!login) {
      throw new AppError("BAD_GITHUB_USER", 400, "Enter a GitHub username, or a link like github.com/username.")
    }
    try {
      const corpus = await githubCorpus(login, { token: process.env.GITHUB_TOKEN?.trim() || undefined })
      return Response.json({
        source: { name: "github", text: corpus.text },
        login: corpus.login,
        repos: corpus.repos,
      })
    } catch (e) {
      if (e instanceof GithubError) throw new AppError(`GITHUB_${e.code}`, STATUS[e.code], e.message)
      throw e
    }
  } catch (e) {
    return errorResponse(e)
  }
}
