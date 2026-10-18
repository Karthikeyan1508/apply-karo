"use client"

import { Popover } from "@base-ui/react/popover"
import {
  ChevronDownIcon,
  FileTextIcon,
  LogOutIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { useEffect } from "react"
import { toast } from "sonner"
import { GoogleMark } from "@/components/brand/google-mark"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { refreshAuth, useAuth, useSyncEnabled } from "@/hooks/use-auth"
import { authClient, signInWithGoogle } from "@/lib/auth/client"
import { deleteSynced, setSyncEnabled, syncProfile } from "@/lib/profile"
import type { AuthInfo } from "@/lib/types"
import { cn } from "@/lib/utils"

const NOTICE: Record<
  string,
  [kind: "success" | "error" | "message", text: string]
> = {
  ok: ["success", "Signed in with Google"],
  forms: ["success", "Google Forms connected. Paste the form's edit link."],
  denied: ["message", "Google sign-in was cancelled"],
  error: ["error", "Google sign-in failed. Try again."],
  signin_required: ["message", "Sign in first, then connect Google Forms."],
  forms_not_configured: [
    "error",
    "Connecting Google Forms isn't set up yet. See Setup.",
  ],
}

let noticed = false
let synced: string | null = null

/** The sign-in round trip ends on /?auth=...: say what happened once, then tidy the address. */
function useAuthNotice() {
  useEffect(() => {
    if (noticed) return
    noticed = true
    const reason = new URLSearchParams(location.search).get("auth")
    if (!reason) return
    const hit = NOTICE[reason]
    if (hit) toast[hit[0]](hit[1])
    history.replaceState(null, "", location.pathname)
  }, [])
}

/** Once per page load, if this person turned sync on, bring the account and this device level. */
function useSyncOnSignIn(info: AuthInfo | null, on: boolean) {
  const email = info?.user?.email
  useEffect(() => {
    if (!email || !info?.sync || !on || synced === email) return
    synced = email
    void syncProfile()
  }, [email, info?.sync, on])
}

function Avatar({ user }: { user: NonNullable<AuthInfo["user"]> }) {
  return user.picture ? (
    // eslint-disable-next-line @next/next/no-img-element -- a Google profile picture, not worth the image optimiser
    <img
      src={user.picture}
      alt=""
      referrerPolicy="no-referrer"
      className="size-9 rounded-[3px] object-cover"
    />
  ) : (
    <span className="grid size-9 place-items-center rounded-[3px] bg-foreground text-sm font-bold text-background">
      {user.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Sign in with Google, or the signed-in account with what it is allowed to do. Hidden until Google is set up. */
export function AccountMenu() {
  const info = useAuth()
  const syncing = useSyncEnabled()
  useAuthNotice()
  useSyncOnSignIn(info, syncing)

  if (!info?.configured) return null
  const user = info.user
  if (!user) {
    return (
      <Button
        variant="outline"
        className="h-9 gap-2 px-2.5 sm:px-3"
        aria-label="Sign in with Google"
        onClick={() => void signInWithGoogle()}
      >
        <GoogleMark />
        <span className="hidden sm:inline">Sign in with Google</span>
      </Button>
    )
  }

  async function toggleSync(on: boolean) {
    setSyncEnabled(on)
    if (!on) return
    const n = await syncProfile()
    if (n === null)
      toast.warning(
        "Couldn't reach your account. Sync is on and will retry when you save."
      )
    else
      toast.success(
        `Synced. ${n} saved ${n === 1 ? "fact" : "facts"} in your account.`
      )
  }

  async function signOut() {
    await fetch("/api/forms/disconnect", { method: "POST" })
    await authClient.signOut()
    synced = null
    await refreshAuth()
    toast.success("Signed out")
  }

  const row =
    "flex w-full items-center gap-3 rounded-[3px] px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted"

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Account menu"
        className="flex h-10 items-center gap-2 rounded-[3px] border bg-background/40 py-0 pr-2.5 pl-0.5 outline-offset-2 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Avatar user={user} />
        <span className="hidden max-w-32 truncate text-sm font-semibold md:inline">
          {user.name.split(" ")[0]}
        </span>
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={8}
          className="isolate z-50"
        >
          <Popover.Popup className="w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-background p-1.5 text-sm text-foreground shadow-2xl outline-none">
            <div className="flex items-center gap-3 px-3 py-3">
              <Avatar user={user} />
              <div className="min-w-0">
                <p className="truncate font-semibold">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </div>
            <div className="my-1 border-t" />

            {info.forms ? (
              <div className={cn(row, "hover:bg-transparent")}>
                <FileTextIcon className="size-4 shrink-0" />
                <span className="flex-1">Google Forms</span>
                <span className="label-caps text-brand">Connected</span>
              </div>
            ) : info.formsAvailable ? (
              <a href="/api/forms/start" className={row}>
                <FileTextIcon className="size-4 shrink-0" />
                <span className="flex-1">Connect Google Forms</span>
                <span className="text-xs text-muted-foreground">
                  private forms
                </span>
              </a>
            ) : (
              <div
                className={cn(
                  row,
                  "text-muted-foreground hover:bg-transparent"
                )}
              >
                <FileTextIcon className="size-4 shrink-0" />
                <span className="flex-1">Google Forms</span>
                <span className="label-caps">Not set up</span>
              </div>
            )}

            <label
              className={cn(
                row,
                "cursor-pointer",
                !info.sync &&
                  "cursor-default text-muted-foreground hover:bg-transparent"
              )}
              title={
                info.sync
                  ? undefined
                  : "Needs a database. Add DATABASE_URL to .env.local."
              }
            >
              <RefreshCwIcon className="size-4 shrink-0" />
              <span className="flex-1">Sync saved facts</span>
              <Switch
                checked={syncing && info.sync}
                disabled={!info.sync}
                onCheckedChange={toggleSync}
                aria-label="Sync saved facts across devices"
                className="rounded-[3px] **:data-[slot=switch-thumb]:rounded-[2px]"
              />
            </label>

            {info.sync && (
              <button
                type="button"
                className={row}
                onClick={async () =>
                  (await deleteSynced())
                    ? toast.success("Deleted from your account")
                    : toast.warning("Couldn't reach your account")
                }
              >
                <Trash2Icon className="size-4 shrink-0" />
                <span className="flex-1">Delete my synced data</span>
              </button>
            )}

            <div className="my-1 border-t" />
            <button type="button" className={row} onClick={signOut}>
              <LogOutIcon className="size-4 shrink-0" />
              <span className="flex-1">Log out</span>
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
