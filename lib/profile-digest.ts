import type { ProfileItem } from "./types"

/**
 * What is already known about the person, as plain lines for the interviewer's context. It lets the agent
 * understand the questions against the person's real background and not ask what is already known. It is
 * background only: the agent still cannot record any of it as something the person said.
 */
export function profileDigest(facts: readonly ProfileItem[], max = 3500): string {
  const plain = (f: ProfileItem) => !f.key || !f.key.includes(":")
  const line = (f: ProfileItem) => `- ${f.label}: ${f.value.replace(/\s+/g, " ").trim().slice(0, 220)}`
  const ordered = [...facts.filter((f) => f.value.trim() && plain(f)), ...facts.filter((f) => f.value.trim() && !plain(f))]
  const out: string[] = []
  let used = 0
  for (const f of ordered) {
    const l = line(f)
    if (used + l.length + 1 > max) break
    out.push(l)
    used += l.length + 1
  }
  return out.join("\n")
}

/** The note added to the agent's `context`: the digest, framed so it is used as background and not read out. */
export function knownNote(facts: readonly ProfileItem[]): string | null {
  const digest = profileDigest(facts)
  return digest
    ? `Already known about this person (from their resume, GitHub and earlier forms). Use it to understand the questions and do not ask for it again. It is background: never present it as something they just said.\n${digest}`
    : null
}
