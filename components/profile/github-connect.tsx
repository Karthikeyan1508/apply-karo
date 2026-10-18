"use client"

import { ArrowUpRightIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useHealth } from "@/hooks/use-health"
import {
  clearLink,
  connect,
  GITHUB_EVENT,
  loadLink,
  loadRepos,
  readLinkRaw,
  refresh,
  startDevice,
  waitForApproval,
  type DeviceCode,
} from "@/lib/github-client"

function subscribe(onChange: () => void) {
  window.addEventListener(GITHUB_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(GITHUB_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

/** Whether a GitHub account is connected on this device. The raw text only changes when the connection does. */
function useLinked() {
  const raw = useSyncExternalStore(subscribe, readLinkRaw, () => null)
  return raw ? { link: loadLink(), repos: loadRepos() } : null
}

/**
 * Connect a GitHub account so BolBharo can read every repo it can see, private ones included. The person
 * types a short code at github.com/login/device: no redirect, so it works inside the side panel too.
 */
export function GithubConnect({ className }: { className?: string }) {
  const health = useHealth()
  const linked = useLinked()
  const [code, setCode] = useState<DeviceCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stop = useRef(false)

  useEffect(
    () => () => {
      stop.current = true
    },
    []
  )

  async function begin() {
    setError(null)
    setBusy(true)
    stop.current = false
    try {
      const c = await startDevice()
      setCode(c)
      const result = await waitForApproval(c, () => stop.current)
      if (result === "cancelled") return
      if (result === "denied" || result === "expired") {
        setError(result === "denied" ? "You declined on GitHub." : "The code ran out. Try again.")
        return
      }
      const { login, repos } = await connect(result.token)
      toast.success(`Connected @${login}: ${repos.length} repositories`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect GitHub.")
    } finally {
      setCode(null)
      setBusy(false)
    }
  }

  async function reload() {
    setBusy(true)
    setError(null)
    try {
      const { repos } = await refresh()
      toast.success(`${repos.length} repositories`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't refresh.")
    } finally {
      setBusy(false)
    }
  }

  const frame = "rounded-[3px] border bg-foreground/[0.04] p-4 text-sm"

  if (linked?.link) {
    const priv = linked.repos.filter((r) => r.private).length
    return (
      <div className={`${frame} ${className ?? ""}`}>
        <p className="font-semibold">GitHub connected: @{linked.link.login}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {linked.repos.length} repositories{priv ? `, ${priv} private` : ""}. When you describe a project, the matching repo
          answers what it can and you are asked only the rest.
        </p>
        {error && <p role="alert" className="mt-2 text-xs font-medium text-destructive">{error}</p>}
        <div className="mt-3 flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={reload}>
            {busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              clearLink()
              toast.success("GitHub disconnected on this device")
            }}
          >
            Disconnect
          </Button>
        </div>
      </div>
    )
  }

  if (health && !health.github) {
    return (
      <p className={`text-xs text-muted-foreground ${className ?? ""}`}>
        To connect a GitHub account with its private repos, add <code>GITHUB_CLIENT_ID</code> to <code>.env.local</code> (see Setup).
      </p>
    )
  }

  return (
    <div className={`${frame} ${className ?? ""}`}>
      <p className="font-semibold">Connect GitHub (all repos)</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Reads your public and private repositories so project questions are answered from the code. It only reads.
      </p>
      {code ? (
        <div className="mt-3">
          <p className="label-caps text-muted-foreground">Type this code on GitHub</p>
          <p className="display mt-1 text-3xl tracking-widest tabular-nums" aria-live="polite">
            {code.userCode}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" nativeButton={false} render={<a href={code.verificationUri} target="_blank" rel="noreferrer" />}>
              Open GitHub <ArrowUpRightIcon />
            </Button>
            <span className="text-xs text-muted-foreground">Waiting for you to approve…</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                stop.current = true
                setCode(null)
                setBusy(false)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" className="mt-3" disabled={busy || !health} onClick={begin}>
          {busy ? <Loader2Icon className="animate-spin" /> : null} Connect GitHub
        </Button>
      )}
      {error && <p role="alert" className="mt-2 text-xs font-medium text-destructive">{error}</p>}
    </div>
  )
}
